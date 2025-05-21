require("dotenv").config();
const puppeteer = require("puppeteer");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5000; // 5초마다 (너무 짧으면 컨텍스트가 불안정할 수 있음)
const TARGET_URL = "https://bugsnft.com/exchange";
const GRADES = ["골드", "플래티넘", "다이아몬드"];
const PRICE_THRESHOLD = 10_000_00; // 10,000,00 BGSC 이하 알림

let browser, page;
const notified = {}; // { grade: lastNotifiedPrice }

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

/** DOM에서 “필터” 토글 열기 */
async function clickFilterToggle() {
  try {
    const ok = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "필터"
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log(ok ? "✔️ 필터 패널 열림" : "⚠️ 필터 패널 열림 실패");
    return ok;
  } catch (e) {
    console.warn("clickFilterToggle 에러:", e.message);
    return false;
  }
}

/** 희귀도 필터 버튼 클릭 */
async function clickRarityFilter(label) {
  try {
    const clicked = await page.evaluate((lbl) => {
      const h2 = [...document.querySelectorAll("h2")].find((el) =>
        el.textContent.includes("희귀도 필터")
      );
      if (!h2?.nextElementSibling) return false;
      const btn = [...h2.nextElementSibling.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === lbl
      );
      if (!btn) return false;
      btn.click();
      return true;
    }, label);
    console.log(
      clicked ? `✔️ "${label}" 버튼 클릭됨` : `⚠️ "${label}" 버튼 클릭 실패`
    );
    return clicked;
  } catch (e) {
    console.warn(`clickRarityFilter("${label}") 에러:`, e.message);
    return false;
  }
}

/** 현재 화면 가격 검사 후 알림 */
async function checkPricesAndNotify(grade) {
  try {
    const prices = await page.$$eval(".enhanced-nft-price", (nodes) =>
      nodes
        .map((el) => el.textContent.trim())
        .filter((text) => text.includes("BGSC"))
        .map((text) => parseInt(text.replace(/[^0-9]/g, ""), 10))
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
  } catch (e) {
    console.warn(`checkPricesAndNotify("${grade}") 에러:`, e.message);
  }
  return false;
}

/** 한 사이클 검사 */
async function checkOnce() {
  try {
    // (1) 페이지 네비게이트
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 0 });

    // (2) 필터 열기
    if (!(await clickFilterToggle())) return;

    // (3) 등급별 루프
    for (const grade of GRADES) {
      if (!(await clickRarityFilter(grade))) continue;

      // 카드가 하나라도 로드될 때까지 대기
      try {
        await page.waitForSelector(".enhanced-nft-card", { timeout: 5000 });
      } catch {
        console.warn(`⚠️ "${grade}" 카드 로드 대기 실패`);
        continue;
      }

      // 가격 검사
      if (await checkPricesAndNotify(grade)) {
        // 한 번이라도 알림 보냈으면 남은 등급 스킵
        break;
      }
    }
  } catch (err) {
    console.error("전체 체크 중 치명적 오류:", err.message);
  } finally {
    // (4) 다음 사이클 예약
    setTimeout(checkOnce, CHECK_INTERVAL_MS);
  }
}

(async () => {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  // 첫 실행 시작
  await checkOnce();
})();
