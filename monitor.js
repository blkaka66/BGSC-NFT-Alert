require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3 * 1000; // 3초

const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10000000;

const notified = {};

let browser, page;

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

async function clickGradeButton(page, grade) {
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const text = await page.evaluate((el) => el.innerText.trim(), btn);
    if (text === grade) {
      await btn.click();
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

async function extractLowestPrice(page) {
  const prices = await page.$$eval(".enhanced-nft-price span", (spans) =>
    spans.map((el) =>
      parseFloat(el.innerText.replace(/,/g, "").replace("BGSC", "").trim())
    )
  );
  return Math.min(...prices.filter((n) => !isNaN(n)));
}

async function checkNFTPrices() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    for (const grade of GRADES) {
      const clicked = await clickGradeButton(page, grade);
      if (!clicked) {
        console.warn(`${grade} 버튼 클릭 실패`);
        continue;
      }

      const price = await extractLowestPrice(page);
      console.log(`[${grade}] 최저가: ${price} BGSC`);

      if (price <= PRICE_THRESHOLD && notified[grade] !== price) {
        const message = `[감지됨] ${grade} 등급 NFT가 ${price} BGSC 입니다.`;
        await sendTelegramMessage(message);
        notified[grade] = price;
      }
    }
  } catch (error) {
    console.error("NFT 가격 확인 중 오류:", error.message);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  await checkNFTPrices(); // 초기 1회 실행

  setInterval(checkNFTPrices, CHECK_INTERVAL);
})();
