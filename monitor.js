require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

// ----------------------------------
// 상수 선언
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5000;
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 1_000_000;

let browser, page;
const notified = {};

// ----------------------------------
// 함수 정의

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

// 필터 모달 열기 (label 텍스트의 버튼이 보일 때까지)
async function openFilterModal(label) {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) throw new Error("필터 버튼을 찾을 수 없음");
    btn.click();
  });
  console.log("✔️ 필터 버튼 클릭됨");

  await page.waitForFunction(
    (lbl) =>
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent.trim() === lbl
      ),
    { timeout: 10000 },
    label
  );
  console.log(`✔️ 필터 모달 열림 (${label} 버튼 확인)`);
}

// 모달에서 등급(label) 버튼 클릭
async function clickRarityFilter(label) {
  await page.evaluate((lbl) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === lbl
    );
    btn.click();
  }, label);
  console.log(`✔️ "${label}" 버튼 클릭됨`);
}

// 첫 번째 매물 가격 검사 후 알림
async function checkFirstPriceAndNotify(grade) {
  // 카드가 렌더링될 때까지 대기
  await page.waitForSelector(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    { timeout: 5000 }
  );

  // 첫 번째 가격 텍스트 가져오기
  const priceText = await page.$eval(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    (el) => el.textContent
  );
  const price = parseInt(priceText.replace(/[^0-9]/g, ""), 10);
  console.log(`${grade} 첫 매물 가격: ${price.toLocaleString()} BGSC`);

  // 알림 조건 확인
  if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
    const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
    await sendTelegramMessage(msg);
    notified[grade] = price;
    return true;
  }
  return false;
}

// 한 사이클 검사
async function checkOnce() {
  console.log("🚀 checkOnce 시작");
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    for (const grade of GRADES) {
      await openFilterModal(grade);
      await clickRarityFilter(grade);

      if (await checkFirstPriceAndNotify(grade)) {
        break;
      }
      // 다음 등급 검사 전, 필터 모달 다시 열기
    }
  } catch (e) {
    console.error("❌ 체크 중 오류:", e.message || e);
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

  // 초기 한 번 실행
  await checkOnce();

  // 이후 주기적 실행
  setInterval(async () => {
    console.log("⏰ 주기적 체크 시작");
    await checkOnce();
  }, CHECK_INTERVAL_MS);
})();
