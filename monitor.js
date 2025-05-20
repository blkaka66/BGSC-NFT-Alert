require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL = 3000; // 3초마다
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["브론즈", "실버", "골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_000; // 10,000,000 BGSC 이하 알림

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

/** 텔레그램 메시지 전송 */
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

/** 지연 함수 */
async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/** “필터” 버튼 클릭 (토글) */
async function clickButtonByText(text) {
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const btnText = await page.evaluate((el) => el.textContent.trim(), btn);
    if (btnText === text) {
      await btn.click();
      console.log(`✔️ "${text}" 버튼 클릭`);
      return true;
    }
  }
  console.warn(`⚠️ "${text}" 버튼 클릭 실패`);
  return false;
}

/**
 * “희귀도 필터” 제목 h2를 찾아, 그 다음 형제 컨테이너의 버튼 중
 * label 텍스트와 매칭되는 버튼을 클릭
 */
async function clickRarityFilter(label) {
  const headings = await page.$$("h2");
  for (const h2 of headings) {
    const txt = await page.evaluate((el) => el.textContent.trim(), h2);
    if (txt.includes("희귀도 필터")) {
      // h2 다음 형제 요소(버튼 컨테이너)
      const containerHandle = await page.evaluateHandle(
        (el) => el.nextElementSibling,
        h2
      );
      const buttons = await containerHandle.$$("button");
      for (const btn of buttons) {
        const span = await btn.$("span.relative.z-10");
        const btnText = span
          ? await page.evaluate((el) => el.textContent.trim(), span)
          : "";
        if (btnText === label) {
          await btn.click();
          console.log(`✔️ "${label}" 필터 클릭됨`);
          return true;
        }
      }
    }
  }
  console.warn(`⚠️ "${label}" 필터 버튼을 찾지 못함`);
  return false;
}

/**
 * 표시된 NFT 가격들 중, 임계값 이하가 있으면 알림
 */
async function checkPricesAndNotify(grade) {
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

/** 한 번 스캔 */
async function checkOnce() {
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    // 1) 필터 토글 열기
    if (!(await clickButtonByText("필터"))) return;
    await delay(1000);

    // 2) 등급별 필터 클릭 & 가격 체크
    for (const grade of GRADES) {
      if (!(await clickRarityFilter(grade))) continue;
      await delay(2000);
      if (await checkPricesAndNotify(grade)) return;
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

  // 최초 실행
  await checkOnce();
  // 주기 실행
  setInterval(checkOnce, CHECK_INTERVAL);
})();
