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
// (1) 필터 패널 열고, 원하는 등급 버튼이 보일 때까지 대기
async function openFilterPanel(label) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "필터"
    );
    if (!btn) throw new Error("필터 버튼 없음");
    btn.click();
  });
  console.log("✔️ 필터 패널 열림");

  await page.waitForFunction(
    (lbl) =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === lbl
      ),
    { timeout: 5000 },
    label
  );
  console.log(`✔️ "${label}" 버튼 렌더링 확인`);
}

// (2) 모달 안에서 등급 버튼 클릭 후, 패널 닫기
async function applyRarityFilter(label) {
  // 클릭
  await page.evaluate((lbl) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === lbl
    );
    if (!btn) throw new Error(`${lbl} 버튼 없음`);
    btn.click();
  }, label);
  console.log(`✔️ "${label}" 버튼 클릭됨`);

  // 패널 닫기 (필터 토글 재클릭)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "필터"
    );
    btn.click();
  });
  console.log("✔️ 필터 패널 닫힘");

  // 필터 버튼만 남을 때까지 대기 (panel closed 확인)
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "필터"
      ) &&
      ![...document.querySelectorAll("button")].some((b) =>
        ["골드", "플래티넘", "다이아몬드"].includes(b.textContent.trim())
      ),
    { timeout: 5000 }
  );
}

// ----------------------------------
// (3) 첫 번째 매물 가격 읽어서 알림
async function checkFirstPriceAndNotify(grade) {
  // 첫 카드 가격 span (숫자용 span:last-child) 렌더링 대기
  try {
    await page.waitForSelector(
      ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span:last-child",
      { timeout: 5000 }
    );
  } catch {
    console.log(`❌ ${grade} 매물 없음`);
    return false;
  }

  // 텍스트 추출
  const priceText = await page.$eval(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span:last-child",
    (el) => el.textContent
  );
  const price = parseInt(priceText.replace(/[^0-9]/g, ""), 10);
  console.log(`🔖 ${grade} 첫 매물 가격: ${price.toLocaleString()} BGSC`);

  if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
    const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
    await sendTelegramMessage(msg);
    notified[grade] = price;
    return true;
  }
  return false;
}

// ----------------------------------
// 한 사이클 검사: 등급별로 page.goto → 필터 적용 → 가격 검사
async function checkOnce() {
  console.log("🚀 checkOnce 시작");
  for (const grade of GRADES) {
    try {
      console.log(`▶️ ${grade} 검사`);
      await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });
      await openFilterPanel(grade);
      await applyRarityFilter(grade);
      if (await checkFirstPriceAndNotify(grade)) break;
    } catch (e) {
      console.error(`❌ ${grade} 검사 중 오류:`, e.message || e);
    }
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

  // 최초 한 번
  await checkOnce();

  // 이후 주기 실행
  setInterval(async () => {
    console.log("⏰ 주기적 체크 시작");
    await checkOnce();
  }, CHECK_INTERVAL_MS);
})();
