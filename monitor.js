require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

// ----------------------------------
// 상수 선언
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5000;
const TARGET_URL = "https://bugsnft.com/exchange";
// 등급 배열
const GRADES = ["골드", "플래티넘", "다이아몬드"];
// 알림 기준 가격
const PRICE_THRESHOLD = 1_000_000;

let browser, page;
const notified = {};

// ----------------------------------
// Telegram 메시지 전송
async function sendTelegramMessage(message) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: message }
    );
  } catch (err) {
    console.error("텔레그램 전송 오류:", err.message);
  }
}

// ----------------------------------
// 필터 모달 열기
async function openFilterModal() {
  await page.click("button.metallic-button");
  console.log("✔️ 필터 버튼 클릭됨");
  await page.waitForFunction(
    () => {
      const modal = document.querySelector("wcm-modal");
      if (!modal) return false;
      return Array.from(modal.querySelectorAll("button")).some(
        (b) => b.textContent.trim() === "골드"
      );
    },
    { timeout: 5000 }
  );
  console.log("✔️ 필터 모달 열림");
}

// ----------------------------------
// 모달에서 등급 버튼 클릭
async function clickRarityFilter(label) {
  await page.evaluate((lbl) => {
    const modal = document.querySelector("wcm-modal");
    if (!modal) return;
    const btn = Array.from(modal.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === lbl
    );
    btn?.click();
  }, label);
  console.log(`✔️ "${label}" 버튼 클릭됨`);
}

// ----------------------------------
// 첫 번째 매물 가격 가져오기
async function getFirstPrice() {
  const selector =
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span:nth-of-type(2)";
  await page.waitForSelector(selector, { timeout: 5000 });
  const priceText = await page.$eval(selector, (el) =>
    el.textContent.trim().replace(/[^0-9]/g, "")
  );
  return parseInt(priceText, 10);
}

// ----------------------------------
// 한 사이클 검사
async function checkOnce() {
  console.log("🚀 checkOnce 시작");
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });
    await openFilterModal();

    for (const grade of GRADES) {
      console.log(`▶️ ${grade} 검사`);
      await clickRarityFilter(grade);

      try {
        const price = await getFirstPrice();
        console.log(`${grade} 첫 매물 가격: ${price.toLocaleString()} BGSC`);

        if (
          price > 0 &&
          price <= PRICE_THRESHOLD &&
          notified[grade] !== price
        ) {
          const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
          await sendTelegramMessage(msg);
          notified[grade] = price;
          break;
        }
      } catch (e) {
        console.error(`${grade} 첫 매물 가격 파싱 실패:`, e.message);
      }

      await openFilterModal();
    }
  } catch (err) {
    console.error("체크 중 오류:", err);
  }
}

// ----------------------------------
// IIFE: 초기 실행 + 주기 실행
(async () => {
  console.log("🛠️ 모니터링 서비스 시작");
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 초기 한 번
  await checkOnce();
  // 이후 주기적
  setInterval(async () => {
    console.log("⏰ 주기적 체크 시작");
    await checkOnce();
  }, CHECK_INTERVAL_MS);
})();
