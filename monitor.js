require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3000; // 3초
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000;

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

/** Telegram 메시지 전송 */
async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: message });
  } catch (err) {
    console.error("텔레그램 전송 실패:", err.message);
  }
}

/** 딜레이 헬퍼 */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/** 필터 토글 버튼 클릭 (열려 있으면 닫히고, 닫혀 있으면 열린다) */
async function clickFilterToggle() {
  const ok = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log(ok ? "✔️ 필터 패널 열림" : "⚠️ 필터 버튼 없음");
  return ok;
}

/** 희귀도 필터 버튼 클릭 */
async function clickRarityFilter(label) {
  const clicked = await page.evaluate((label) => {
    // 필터 패널 안에서 라벨이 정확히 일치하는 버튼 찾기
    const btn = [
      ...document.querySelectorAll(".wcm-wallet-icon-border-radius button"),
      ...document.querySelectorAll("button"),
    ].find((b) => b.textContent.trim() === label);

    if (!btn) return false;
    btn.click();
    return true;
  }, label);

  console.log(
    clicked ? `✔️ "${label}" 버튼 클릭됨` : `⚠️ "${label}" 버튼 클릭 실패`
  );
  return clicked;
}

/** 가격 읽어와서 알림 */
async function checkPricesAndNotify(grade) {
  // 화면에 보이는 모든 가격 span에서 BGSC 텍스트 걸러내기
  const prices = await page.$$eval(".enhanced-nft-price span", (spans) =>
    spans
      .map((s) => s.textContent.trim())
      .filter((t) => t.includes("BGSC"))
      .map((t) => parseInt(t.replace(/[^0-9]/g, ""), 10))
  );
  console.log(`${grade} 단계 가격 목록: [${prices.join(", ")}]`);

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
      await sendTelegramMessage(msg);
      notified[grade] = price;
      console.log(`🔔 ${msg}`);
      return true;
    }
  }
  return false;
}

/** 한 사이클 검사 */
async function checkOnce() {
  try {
    await page.goto(TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 0,
    });

    for (const grade of GRADES) {
      // 1) 필터 패널 열기
      if (!(await clickFilterToggle())) return;

      // 2) 클릭 후 리스트 로딩 대기
      await delay(1000);

      // 3) 등급 버튼 클릭
      if (!(await clickRarityFilter(grade))) continue;

      // 4) NFT 카드가 그레이드 필터 후 갱신될 때까지 대기
      await page.waitForSelector(".enhanced-nft-card", { timeout: 5000 });
      await delay(500);

      // 5) 가격 검사 & 알림
      if (await checkPricesAndNotify(grade)) {
        // 알림 보냈으면 이 사이클 종료
        return;
      }
    }
  } catch (err) {
    console.error("체크 중 오류:", err.message);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 초기 한 번
  await checkOnce();
  // 주기 실행
  setInterval(checkOnce, CHECK_INTERVAL);
})();
