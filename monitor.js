require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5000;
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000;

let browser, page;
const notified = {};

/** Telegram 메시지 전송 */
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

/** 필터 패널 한 번만 열기 */
async function ensureFilterOpen() {
  const isOpen = await page
    .$eval(".filter-panel", (el) => el.classList.contains("open"))
    .catch(() => false);

  if (!isOpen) {
    const btn = await page.$x(`//button[normalize-space()="필터"]`);
    if (btn[0]) {
      await btn[0].click();
      await page.waitForSelector(".filter-panel.open", { timeout: 5000 });
      console.log("필터 패널 열림");
    } else {
      console.warn("필터 버튼을 찾지 못함");
    }
  }
}

/** 무한 스크롤로 전체 로드 */
async function scrollToEnd() {
  await page.evaluate(async () => {
    const sc = document.querySelector(".nft-list-container");
    let prev = 0;
    while (sc.scrollHeight !== prev) {
      prev = sc.scrollHeight;
      sc.scrollTop = sc.scrollHeight;
      await new Promise((r) => setTimeout(r, 500));
    }
  });
}

/** 희귀도 필터 클릭 */
async function clickRarityFilter(label) {
  await page.evaluate((lbl) => {
    const h2 = [...document.querySelectorAll("h2")].find((el) =>
      el.textContent.includes("희귀도 필터")
    );
    const btn = h2?.nextElementSibling
      .querySelectorAll("button")
      .find((b) => b.textContent.trim() === lbl);
    btn?.click();
  }, label);
  await page
    .waitForSelector(".enhanced-nft-card", { timeout: 5000 })
    .catch(() => console.warn(`${label} 카드 로드 실패`));
  console.log(`${label} 버튼 클릭됨`);
}

/** 가격 검사 후 알림 */
async function checkPricesAndNotify(grade) {
  const prices = await page.$$eval(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    (spans) =>
      spans
        .map((s) => s.textContent.replace(/[^0-9]/g, ""))
        .filter((t) => t)
        .map((t) => parseInt(t, 10))
  );
  console.log(`${grade} 단계 가격 목록:`, prices);

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT ${price.toLocaleString()} BGSC 감지됨`;
      await sendTelegramMessage(msg);
      notified[grade] = price;
      return true;
    }
  }
  return false;
}

async function checkOnce() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });
    await ensureFilterOpen();
    await scrollToEnd();

    for (const grade of GRADES) {
      await clickRarityFilter(grade);
      if (await checkPricesAndNotify(grade)) break;
    }
  } catch (err) {
    console.error("체크 중 오류:", err.message);
  } finally {
    setTimeout(checkOnce, CHECK_INTERVAL_MS);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  await checkOnce();
})();
