// dataManager.js - 데이터 관리 및 API 호출

import {
  renderTable,
  updateHeaderArrows,
  showLoading,
  showNotification,
  setFilteredStocks,
  getFilteredStocks,
  getPageSize,
  resetScrollPosition,
} from "./uiManager.js";

// 검색 종목 조회
export async function fetchStockData(stockCodes, marketCode) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_MULTIPLE_STOCKS",
      data: {
        stockCodes: stockCodes,
        marketCode: marketCode,
      },
    });

    if (response && response.success) {
      return response.data || [];
    } else {
      const errorMessage = response?.error || "API 응답 오류";
      console.error("API 응답 실패:", errorMessage);
      showNotification(errorMessage, "error");
      throw new Error(errorMessage);
    }
  } catch (error) {
    console.error("API 데이터 조회 실패:", error);

    // Background script 연결 오류인 경우
    if (error.message.includes("Receiving end does not exist")) {
      showNotification(
        "확장 프로그램이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
        "warning"
      );
    } else {
      showNotification("데이터를 가져오는 중 오류가 발생했습니다.", "error");
    }
    return [];
  }
}

// 공통 API 호출 함수
export async function callApi(type, data) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: type,
      data: data,
    });

    if (response && response.success) {
      return response.data || [];
    } else {
      const errorMessage = response?.error || "API 응답 오류";
      console.error(`API 응답 실패 (${type}):`, errorMessage); //여기서 500 에러를 잡는다.
      showNotification(errorMessage, "error");
      throw new Error(errorMessage);
    }
  } catch (error) {
    console.error(`API 호출 실패 (${type}):`, error);

    // Background script 연결 오류인 경우
    if (error.message.includes("Receiving end does not exist")) {
      showNotification(
        "확장 프로그램이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
        "warning"
      );
    } else {
      showNotification("데이터를 가져오는 중 오류가 발생했습니다.", "error");
    }
    return [];
  }
}

//@Deprecated 실시간 데이터 시작 (추후 삭제)
export async function startRealTimeData(stockCodes) {
  const maxRetries = 3;
  let retryCount = 0;

  const attemptConnection = async () => {
    try {
      // callApi 함수 사용
      const response = await callApi("START_REAL_TIME", stockCodes);

      if (response && response.success) {
        return true;
      } else {
        console.error(
          "실시간 데이터 시작 실패:",
          response?.error || "알 수 없는 오류"
        );

        // 자세한 오류 정보 로깅
        if (response?.details) {
          console.error("오류 상세 정보:", response.details);
        }

        // 사용자에게 오류 알림
        const errorMessage =
          response?.error || "실시간 데이터 연결에 실패했습니다.";
        showNotification(errorMessage, "error");

        return false;
      }
    } catch (error) {
      console.error(`실시간 데이터 연결 시도 ${retryCount + 1} 실패:`, error);

      if (error.message.includes("Receiving end does not exist")) {
        console.log("Background script가 아직 로드되지 않았습니다.");
        showNotification(
          "확장 프로그램이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
          "warning"
        );
        return false;
      }
      throw error;
    }
  };

  while (retryCount < maxRetries) {
    try {
      const success = await attemptConnection();
      if (success) {
        return; // 성공 시 즉시 반환
      }

      retryCount++;
      if (retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryCount * 2000));
      }
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        console.error("실시간 데이터 연결 최종 실패:", error);
        // 사용자에게 알림
        showNotification(
          "실시간 데이터 연결에 실패했습니다. API 키를 확인해주세요.",
          "error"
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, retryCount * 2000));
    }
  }
}

// 실시간 데이터 중지
export function stopRealTimeData() {
  callApi("STOP_REAL_TIME", {}).catch((error) => {
    console.error("실시간 데이터 중지 오류:", error);
  });
}

// 종목 검색 (키워드 기반)
export async function filterStocks(searchInput, marketSelect, stockSymbols) {
  const keyword = searchInput.value.trim().toLowerCase();

  // 검색어가 없으면, 시가총액 순위로 다시 조회
  if (!keyword) {
    await filterByMarket(marketSelect);
    return;
  }

  showLoading(true);

  // 검색 시 스크롤 위치 초기화
  resetScrollPosition();

  try {
    // 선택된 마켓에 따라 해당 마켓의 종목만 검색
    const selectedMarket = marketSelect.value;
    const marketSymbols = stockSymbols[selectedMarket] || [];

    // 종목명과 종목코드 모두에서 검색
    const matchedStocks = marketSymbols.filter((s) => {
      const nameMatch = s.name.toLowerCase().includes(keyword);
      const codeMatch = s.code.includes(keyword);
      return nameMatch || codeMatch;
    });

    if (matchedStocks.length > 0) {
      const stockCodes = matchedStocks.map((s) => s.code);
      const marketCode = marketSelect.value;

      // fetchStockData 함수 사용
      const responseData = await fetchStockData(stockCodes, marketCode);

      if (Array.isArray(responseData) && responseData.length > 0) {
        const stocks = responseData.map((d) => ({
          code: d.stck_shrn_iscd, //주식 단축 종목코드
          market: marketCode,
          price: parseFloat(d.stck_prpr) || 0, //현재가
          change_rate: parseFloat(d.prdy_ctrt) || 0, //전일 대비율
          change_price: parseFloat(d.prdy_vrss) || 0, //전일 대비
          volume: parseFloat(d.acml_vol) || 0, //누적 거래량
        }));

        // 검색 결과에 한글 이름 매핑
        stocks.forEach((stock) => {
          const match = matchedStocks.find((s) => s.code === stock.code);
          if (match) stock.name = match.name;
        });

        setFilteredStocks(stocks);
      } else {
        setFilteredStocks([]);
      }
    } else {
      setFilteredStocks([]);
    }

    // 초기 렌더링 - 첫 페이지만 표시
    const allStocks = getFilteredStocks();
    renderTable(allStocks, false, selectedMarket);
    updateHeaderArrows();
    // 검색 결과는 실시간 구독에서 제외
    //stopRealTimeData();
  } catch (error) {
    console.error("검색 중 오류:", error);
  } finally {
    showLoading(false);
  }
}

// 마켓별 필터링 (KOSPI/KOSDAQ)
export async function filterByMarket(marketSelect) {
  const market = marketSelect.value;
  showLoading(true);

  // 마켓 변경 시 스크롤 위치 초기화
  resetScrollPosition();

  try {
    // callApi 함수 사용
    const responseData = await callApi("GET_TOP_VOLUME_STOCKS", {
      marketCode: market,
    });

    if (Array.isArray(responseData) && responseData.length > 0) {
      const stocks = responseData.map((d) => ({
        name: d.name, // 종목명
        code: d.code, // 종목코드
        market: market,
        price: parseFloat(d.price) || 0, // 현재가
        change_price: parseFloat(d.change) || 0, // 전일대비
        change_rate: parseFloat(d.chgrate) || 0, // 등락률
        volume: parseFloat(d.acml_vol) || 0, // 거래량
      }));

      setFilteredStocks(stocks);
    } else {
      console.error("시가총액 상위 종목 조회 실패: 데이터가 없습니다.");
      setFilteredStocks([]);
    }

    // 초기 렌더링 - 첫 페이지만 표시
    const allStocks = getFilteredStocks();
    renderTable(allStocks, false, market);
    updateHeaderArrows();
  } catch (error) {
    console.error("시가총액 상위 종목 조회 중 오류:", error);
  } finally {
    showLoading(false);
  }
}

// 디바운싱 함수
export function debounceSearch(func, delay) {
  let searchTimeout;
  return function (...args) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// 즐겨찾기 목록 저장 (시장별)
export function saveFavorites(favorites, market) {
  localStorage.setItem(`favoriteStocks_${market}`, JSON.stringify(favorites));
}

// 즐겨찾기 목록 불러오기 (시장별)
export function getFavorites(market) {
  const data = localStorage.getItem(`favoriteStocks_${market}`);
  return data ? JSON.parse(data) : [];
}

// 즐겨찾기 토글 (시장별)
export function toggleFavorite(stockCode, market) {
  let favorites = getFavorites(market);
  if (favorites.includes(stockCode)) {
    favorites = favorites.filter((code) => code !== stockCode);
  } else {
    favorites.push(stockCode);
  }
  saveFavorites(favorites, market);
}
