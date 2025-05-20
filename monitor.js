require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3000; // 3초마다
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["브론즈", "실버", "골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 1_0000_000; // 1,0000,000 BGSC 이하 알림

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
  } catch (err) {
    console.error("텔레그램 전송 오류:", err.message);
  }
}

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * 버튼 텍스트로 클릭 (필터 토글 버튼 등에 사용)
 */
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

/**
 * 희귀도 필터 영역에서 레이블로 해당 등급 버튼을 찾아 클릭
 */
async function clickRarityFilter(label) {
  // “희귀도 필터” 섹션 로딩 대기
  await page.waitForSelector('h2:text("희귀도 필터") + div.flex', {
    timeout: 5000,
  });
  // 바로 다음 div.flex 안의 모든 button
  const buttons = await page.$$('h2:text("희귀도 필터") + div.flex button');
  for (const btn of buttons) {
    const span = await btn.$("span.relative.z-10");
    const txt = span
      ? await page.evaluate((el) => el.textContent.trim(), span)
      : "";
    if (txt === label) {
      await btn.click();
      console.log(`${label} 필터 클릭`);
      return true;
    }
  }
  console.warn(`${label} 필터 버튼을 찾지 못함`);
  return false;
}

/**
 * 현재 화면에 표시된 NFT 가격들 중
 * PRICE_THRESHOLD 이하가 있으면 텔레그램 알림
 */
async function checkPricesAndNotify(grade) {
  // .enhanced-nft-price 안의 숫자 텍스트(span:last-child)들
  const prices = await page.$$eval(".enhanced-nft-price span", (spans) =>
    spans
      .map((s) => s.textContent.trim())
      .filter((t) => t.includes("BGSC"))
      .map((t) => parseInt(t.replace(/[^0-9]/g, ""), 10))
  );

  for (const price of prices) {
    if (price > 0 && price <= PRICE_THRESHOLD && notified[grade] !== price) {
      const msg = `[알림] ${grade} 등급 NFT 가격 ${price.toLocaleString()} BGSC 이하 감지됨`;
      await sendTelegramMessage(msg);
      notified[grade] = price;
      console.log(msg);
      return true;
    }
  }
  return false;
}

/**
 * 한 번 스캔
 */
async function checkOnce() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    // 1) 필터 열기
    if (!(await clickButtonByText("필터"))) {
      console.warn("‘필터’ 버튼 클릭 실패");
      return;
    }
    await delay(1000);

    // 2) 등급별 순회
    for (const grade of GRADES) {
      if (!(await clickRarityFilter(grade))) {
        continue;
      }
      await delay(2000);

      if (await checkPricesAndNotify(grade)) {
        // 한 등급에서 알림을 보냈다면 바로 종료
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

  // 초기 한 번 실행
  await checkOnce();
  // 이후 주기적으로
  setInterval(checkOnce, CHECK_INTERVAL);
})();
