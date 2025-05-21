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

async function openFilterModal(label) {
  // “필터” 버튼 텍스트로 클릭
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) throw new Error("필터 버튼 없음");
    btn.click();
  });
  console.log("✔️ 필터 버튼 클릭됨");

  // 원하는 등급 버튼이 보일 때까지 대기
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

async function clickRarityFilter(label) {
  await page.evaluate((lbl) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === lbl
    );
    if (!btn) throw new Error(`${lbl} 버튼 없음`);
    btn.click();
  }, label);
  console.log(`✔️ "${label}" 버튼 클릭됨`);
}

async function checkFirstPriceAndNotify(grade) {
  // 첫 카드 렌더링 대기
  try {
    await page.waitForSelector(
      ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
      { timeout: 5000 }
    );
  } catch {
    console.log(`${grade} 매물 없음`);
    return false;
  }

  // 첫 번째 가격 읽기
  const priceText = await page.$eval(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    (el) => el.textContent
  );
  const price = parseInt(priceText.replace(/[^0-9]/g, ""), 10);
  if (isNaN(price)) {
    console.log(`${grade} 첫 매물 가격 파싱 실패`);
    return false;
  }
  console.log(`${grade} 첫 매물 가격: ${price.toLocaleString()} BGSC`);

  if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
    const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
    await sendTelegramMessage(msg);
    notified[grade] = price;
    return true;
  }
  return false;
}

// ----------------------------------
// 한 사이클 검사 (각 등급마다 페이지 새로고침)
async function checkOnce() {
  console.log("🚀 checkOnce 시작");
  try {
    for (const grade of GRADES) {
      console.log(`🔍 ${grade} 검사 시작`);
      await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });
      console.log("✅ 페이지 로드 완료");

      await openFilterModal(grade);
      await clickRarityFilter(grade);

      const done = await checkFirstPriceAndNotify(grade);
      if (done) break;
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

  await checkOnce();
  setInterval(async () => {
    console.log("⏰ 주기적 체크 시작");
    await checkOnce();
  }, CHECK_INTERVAL_MS);
})();
