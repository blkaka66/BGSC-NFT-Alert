/** 필터 모달 열고 희귀도 버튼 보일 때까지 대기 */
async function openFilterModal() {
  // 1) “필터” 버튼 클릭
  await page.click("button.metallic-button");
  console.log("✔️ 필터 버튼 클릭됨");

  // 2) wcm-modal 안에 버튼이 렌더링될 때까지 대기
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

/** 모달에서 희귀도 버튼 클릭 */
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

/** NFT 카드 그리드 끝까지 스크롤 */
async function scrollGridToEnd() {
  await page.evaluate(async () => {
    const grid = document.querySelector(
      ".grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3.xl\\:grid-cols-4"
    );
    if (!grid) return;
    let prev;
    do {
      prev = grid.scrollHeight;
      grid.scrollTop = prev;
      await new Promise((r) => setTimeout(r, 500));
    } while (grid.scrollHeight !== prev);
  });
  console.log("✔️ 그리드 끝까지 스크롤 완료");
}

/** 가격 검사 */
async function checkPricesAndNotify(grade) {
  const prices = await page.$$eval(
    ".enhanced-nft-card:not(.skeleton) .enhanced-nft-price span",
    (els) =>
      els
        .map((el) => el.textContent.replace(/[^0-9]/g, ""))
        .filter((txt) => txt)
        .map((txt) => parseInt(txt, 10))
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

    // 필터 모달 열기
    await openFilterModal();

    // 등급별 필터 & 스크롤 & 가격 검사
    for (const grade of GRADES) {
      await clickRarityFilter(grade);
      // 모달 닫히고 그리드 갱신될 때 잠시 대기
      await page.waitForTimeout(1000);

      await scrollGridToEnd();
      if (await checkPricesAndNotify(grade)) break;

      // 다음 등급 위해 다시 모달 열기
      await openFilterModal();
    }
  } catch (e) {
    console.error("체크 중 오류:", e.message);
  } finally {
    setTimeout(checkOnce, CHECK_INTERVAL_MS);
  }
}
