require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3000; // 3초마다
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000; // 10,000,000 BGSC 이하 알림

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

/** Telegram 메시지 전송 */
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: message });
  } catch (err) {
    console.error("텔레그램 메시지 전송 실패:", err.message);
  }
}

/** 간단한 딜레이 */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/** “필터” 토글 버튼 클릭 */
async function clickFilterToggle() {
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log(clicked ? "✔️ 필터 토글 클릭" : "⚠️ 필터 토글 클릭 실패");
  return clicked;
}

/** “희귀도 필터” 영역이 로드될 때까지 대기 */
async function waitForRarityPanel() {
  try {
    await page.waitForXPath("//h2[contains(text(), '희귀도 필터')]", {
      timeout: 5000,
    });
    console.log("✔️ 희귀도 필터 패널 로드 완료");
    return true;
  } catch {
    console.warn("⚠️ 희귀도 필터 패널 로드 실패");
    return false;
  }
}

/**
 * 희귀도 필터에서 label 버튼을 찾아 클릭
 * + 디버깅: 실제 버턴 목록을 콘솔에 출력
 */
async function clickRarityFilter(label) {
  const clicked = await page.evaluate((label) => {
    const h2 = [...document.querySelectorAll("h2")].find((el) =>
      el.textContent.includes("희귀도 필터")
    );
    if (!h2 || !h2.nextElementSibling) return false;
    const panel = h2.nextElementSibling;
    const buttons = [...panel.querySelectorAll("button")];
    console.log(
      "[디버깅] 희귀도 필터 버튼 목록:",
      buttons.map((b) => b.textContent.trim())
    );
    const target = buttons.find((b) => b.textContent.trim() === label);
    if (!target) return false;
    target.click();
    return true;
  }, label);

  console.log(
    clicked ? `✔️ "${label}" 버튼 클릭됨` : `⚠️ "${label}" 버튼 클릭 실패`
  );
  return clicked;
}

/** 화면에 표시된 NFT 가격 중 임계치 이하가 있으면 Telegram 알림 */
async function checkPricesAndNotify(grade) {
  const prices = await page.$$eval(".enhanced-nft-price", (cards) =>
    cards
      .map((card) => {
        const spans = card.querySelectorAll("span");
        if (spans.length < 2) return null;
        // 두번째 span 을 가격으로 간주
        const txt = spans[1].textContent || "";
        const num = parseInt(txt.replace(/[^0-9]/g, ""), 10);
        return isNaN(num) ? null : num;
      })
      .filter((n) => n !== null)
  );

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 이하 감지됨`;
      await sendTelegramMessage(msg);
      notified[grade] = price;
      console.log(msg);
      return true;
    }
  }
  return false;
}

/** 한 사이클 검사 */
async function checkOnce() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    // 1) 필터 토글
    if (!(await clickFilterToggle())) return;
    // 2) 패널 로드 대기
    if (!(await waitForRarityPanel())) return;

    // 3) 등급별 순회
    for (const grade of GRADES) {
      if (!(await clickRarityFilter(grade))) continue;
      // 버튼 클릭 후 내용 로드 대기
      await delay(2000);

      if (await checkPricesAndNotify(grade)) {
        // 알림 보냈으면 이 사이클 종료
        return;
      }
    }
  } catch (err) {
    console.error("체크 중 오류:", err);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 초기 실행
  await checkOnce();
  // 주기 실행
  setInterval(checkOnce, CHECK_INTERVAL);
})();
