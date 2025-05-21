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
    console.error("텔레그램 전송 오류:", err.message);
  }
}

/** 간단한 딜레이 */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/** “필터” 토글 버튼 클릭 (한 사이클에 단 한 번만 호출) */
async function clickFilterToggle() {
  const ok = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log(ok ? "✔️ 필터 패널 열림" : "⚠️ 필터 패널 열림 실패");
  return ok;
}

/**
 * 희귀도 필터에서 label(예: “골드”) 버튼을 찾아 클릭
 */
async function clickRarityFilter(label) {
  const clicked = await page.evaluate((label) => {
    const h2 = Array.from(document.querySelectorAll("h2")).find((el) =>
      el.textContent.includes("희귀도 필터")
    );
    if (!h2?.nextElementSibling) return false;
    const btn = Array.from(
      h2.nextElementSibling.querySelectorAll("button")
    ).find((b) => b.textContent.trim() === label);
    if (!btn) return false;
    btn.click();
    return true;
  }, label);

  console.log(
    clicked ? `✔️ "${label}" 버튼 클릭됨` : `⚠️ "${label}" 버튼 클릭 실패`
  );
  return clicked;
}

/** 해당 등급 화면의 가격들 검사 및 알림 */
async function checkPricesAndNotify(grade) {
  // 모든 price span 을 로드해서 숫자만 파싱
  const prices = await page.$$eval(".enhanced-nft-price span", (spans) =>
    spans
      .map((s) => s.textContent.trim())
      .filter((t) => t.includes("BGSC"))
      .map((t) => parseInt(t.replace(/[^0-9]/g, ""), 10))
  );

  console.log(`${grade} 단계 가격 목록:`, prices);

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
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
    await page.goto(TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 0,
    });

    // 1) 필터 패널 열기
    if (!(await clickFilterToggle())) return;
    await delay(1000);

    // 2) 등급별 순차 클릭 → 로드 대기 → 가격 검사
    for (const grade of GRADES) {
      if (!(await clickRarityFilter(grade))) {
        // 클릭 실패해도 다음 등급으로
        continue;
      }

      // 카드가 최소 하나는 로드될 때까지 대기
      await page.waitForSelector(".enhanced-nft-card", {
        timeout: 5000,
      });
      await delay(500);

      // 가격 검사 및 알림
      const found = await checkPricesAndNotify(grade);
      if (found) break; // 알림 보냈으면 남은 등급은 스킵
    }

    // 3) 새로고침 후 다음 사이클 준비
    await page.reload({ waitUntil: "networkidle2", timeout: 0 });
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
