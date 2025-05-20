require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3000;

const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10000000;

let browser, page;
const notified = {};

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (error) {
    console.error("텔레그램 메시지 전송 실패:", error.message);
  }
}

async function clickButtonByText(text) {
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const btnText = await page.evaluate((el) => el.textContent.trim(), btn);
    if (btnText === text) {
      await btn.click();
      return true;
    }
  }
  return false;
}

async function checkPricesAndNotify(grade) {
  const spans = await page.$$(".enhanced-nft-price span");
  for (const span of spans) {
    const text = await page.evaluate((el) => el.textContent, span);
    if (!text.includes("BGSC")) continue;
    const number = parseInt(text.replace(/[^0-9]/g, ""), 10);
    if (number > 0 && number <= PRICE_THRESHOLD && notified[grade] !== number) {
      const message = `[감지됨] ${grade} 등급 NFT 가격 ${number.toLocaleString()} BGSC 이하`;
      await sendTelegramMessage(message);
      notified[grade] = number;
      return true;
    }
  }
  return false;
}

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function checkOnce() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    // 필터 버튼 클릭
    const filterClicked = await clickButtonByText("필터");
    if (!filterClicked) {
      console.warn("필터 버튼 클릭 실패");
      return;
    }
    await delay(1000);

    for (const grade of GRADES) {
      const clicked = await clickButtonByText(grade);
      if (!clicked) {
        console.warn(`${grade} 버튼 클릭 실패`);
        continue;
      }

      await delay(2000);

      const found = await checkPricesAndNotify(grade);
      if (found) return;
    }
  } catch (e) {
    console.error("오류:", e.message);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  await checkOnce();
  setInterval(checkOnce, CHECK_INTERVAL);
})();
