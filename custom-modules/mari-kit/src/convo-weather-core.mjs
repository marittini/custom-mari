// Derived from marinara-convo-weather v0.2.1 (MIT), as kept in ME-personal
// (packages/server/src/assets/convo-weather-core.mjs). Weather data: Open-Meteo (CC BY 4.0).
/*
 * MIT License
 *
 * Copyright (c) 2026 Convo Weather contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * This extension is an independent third-party project and is not endorsed by
 * Pasta-Devs or Open-Meteo. Weather data is supplied by Open-Meteo under CC BY 4.0;
 * the free API is restricted to non-commercial use. Software licensing does not
 * override the data provider's terms. Place search uses GeoNames via Open-Meteo.
 */
const weatherModule = {};
/* Marinara Weather Context — pure helpers, no dependencies or network side effects. */
(function installWeatherCore(root) {
  "use strict";

  const MAX_AGE_MS = 90 * 60 * 1000;
  const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
  const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
  const WMO = Object.freeze({
    0: ["맑음", "clear sky"],
    1: ["대체로 맑음", "mainly clear"],
    2: ["구름 조금", "partly cloudy"],
    3: ["흐림", "overcast"],
    45: ["안개", "fog"],
    48: ["착빙 안개", "depositing rime fog"],
    51: ["약한 이슬비", "light drizzle"],
    53: ["보통 이슬비", "moderate drizzle"],
    55: ["강한 이슬비", "dense drizzle"],
    56: ["약한 어는 이슬비", "light freezing drizzle"],
    57: ["강한 어는 이슬비", "dense freezing drizzle"],
    61: ["약한 비", "slight rain"],
    63: ["보통 비", "moderate rain"],
    65: ["강한 비", "heavy rain"],
    66: ["약한 어는 비", "light freezing rain"],
    67: ["강한 어는 비", "heavy freezing rain"],
    71: ["약한 눈", "slight snowfall"],
    73: ["보통 눈", "moderate snowfall"],
    75: ["강한 눈", "heavy snowfall"],
    77: ["싸락눈", "snow grains"],
    80: ["약한 소나기", "slight rain showers"],
    81: ["보통 소나기", "moderate rain showers"],
    82: ["매우 강한 소나기", "violent rain showers"],
    85: ["약한 소낙눈", "slight snow showers"],
    86: ["강한 소낙눈", "heavy snow showers"],
    95: ["뇌우", "thunderstorm"],
    96: ["약한 우박을 동반한 뇌우", "thunderstorm with slight hail"],
    99: ["강한 우박을 동반한 뇌우", "thunderstorm with heavy hail"],
  });
  Object.values(WMO).forEach(Object.freeze);

  // Approximate, rounded city-centre presets for explicit user selection.
  // These are not GPS measurements, user location, or weather-station coordinates.
  const PRESET_CITIES = Object.freeze(
    [
      ["seoul", "서울", 37.57, 126.98],
      ["busan", "부산", 35.18, 129.08],
      ["incheon", "인천", 37.46, 126.71],
      ["daegu", "대구", 35.87, 128.6],
      ["daejeon", "대전", 36.35, 127.38],
      ["gwangju", "광주", 35.16, 126.85],
      ["ulsan", "울산", 35.54, 129.31],
      ["sejong", "세종", 36.48, 127.29],
      ["suwon", "수원", 37.26, 127.03],
      ["chuncheon", "춘천", 37.88, 127.73],
      ["gangneung", "강릉", 37.75, 128.9],
      ["jeonju", "전주", 35.82, 127.15],
      ["jeju", "제주", 33.5, 126.53],
    ].map(([id, name, latitude, longitude]) =>
      Object.freeze({
        id,
        name,
        label: name + " · 대한민국",
        latitude,
        longitude,
        timezone: "Asia/Seoul",
        country: "대한민국",
        countryCode: "KR",
        admin1: "",
        source: "preset",
      }),
    ),
  );

  function fail(message) {
    throw new Error(message);
  }
  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function cleanText(value, limit = 100) {
    return typeof value === "string"
      ? value
          .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
          .replace(/[<>\[\]]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, limit)
      : "";
  }
  function assertCoordinates(location) {
    if (
      !object(location) ||
      !finite(location.latitude) ||
      !finite(location.longitude) ||
      Math.abs(location.latitude) > 90 ||
      Math.abs(location.longitude) > 180
    ) {
      fail("유효한 지역 좌표가 필요합니다. 지역을 다시 선택해 주세요.");
    }
  }
  function buildWeatherURL(location) {
    assertCoordinates(location);
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current:
        "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "1",
      temperature_unit: "celsius",
      wind_speed_unit: "ms",
      precipitation_unit: "mm",
    });
    return WEATHER_ENDPOINT + "?" + params.toString();
  }
  function buildGeocodingURL(query, koreaOnly = true) {
    const name = cleanText(query, 100);
    if (Array.from(name).length < 2) fail("지역 이름을 두 글자 이상 입력해 주세요.");
    const params = new URLSearchParams({ name, count: "8", language: "ko", format: "json" });
    if (koreaOnly) params.set("countryCode", "KR");
    return GEOCODING_ENDPOINT + "?" + params.toString();
  }
  function normalizePlaces(json) {
    if (!object(json) || json.error) fail("지역 검색 응답을 읽을 수 없습니다.");
    if (json.results === undefined) return [];
    if (!Array.isArray(json.results)) fail("지역 검색 응답 형식이 올바르지 않습니다.");
    const seen = new Set();
    const result = [];
    for (const row of json.results) {
      if (
        !object(row) ||
        !finite(row.latitude) ||
        !finite(row.longitude) ||
        Math.abs(row.latitude) > 90 ||
        Math.abs(row.longitude) > 180
      )
        continue;
      const name = cleanText(row.name, 70);
      if (!name) continue;
      const country = cleanText(row.country, 50);
      const admin1 = cleanText(row.admin1, 60);
      const identity = [name, row.latitude, row.longitude].join("|");
      if (seen.has(identity)) continue;
      seen.add(identity);
      const pieces = [...new Set([name, admin1, country].filter(Boolean))];
      result.push(
        Object.freeze({
          id: Number.isSafeInteger(row.id) && row.id >= 0 ? String(row.id) : identity,
          name,
          label: pieces.join(" · "),
          latitude: row.latitude,
          longitude: row.longitude,
          timezone: cleanText(row.timezone, 80),
          country,
          admin1,
          countryCode:
            typeof row.country_code === "string" && /^[A-Z]{2}$/.test(row.country_code) ? row.country_code : "",
          source: "search",
        }),
      );
      if (result.length === 8) break;
    }
    return result;
  }
  function describeWeather(code) {
    const description = Number.isInteger(code) && Object.prototype.hasOwnProperty.call(WMO, code) ? WMO[code] : null;
    return Object.freeze({
      ko: description ? description[0] : "날씨 정보 없음",
      en: description ? description[1] : "condition unavailable",
    });
  }
  function parseLocalTime(time, offset) {
    if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(time)) {
      fail("날씨 자료의 기준 시각이 올바르지 않습니다.");
    }
    const complete = time.length === 16 ? time + ":00" : time;
    const wallClockMs = Date.parse(complete + "Z");
    if (!Number.isFinite(wallClockMs) || new Date(wallClockMs).toISOString().slice(0, 19) !== complete) {
      fail("날씨 자료의 기준 날짜가 올바르지 않습니다.");
    }
    return wallClockMs - offset * 1000;
  }
  function assertFresh(validAtMs, nowMs) {
    if (!finite(nowMs) || !finite(validAtMs)) fail("날씨 자료의 시각을 확인할 수 없습니다.");
    if (nowMs - validAtMs > MAX_AGE_MS) fail("날씨 자료가 90분 이상 오래되었습니다. 새로고침해 주세요.");
    if (validAtMs - nowMs > MAX_FUTURE_SKEW_MS)
      fail("날씨 자료의 기준 시각이 현재보다 너무 늦습니다. 기기 시각을 확인해 주세요.");
  }
  function measurement(value, unit, expectedUnit, label, minimum, maximum) {
    if (value === null || value === undefined) return null;
    if (!finite(value) || value < minimum || value > maximum) fail(label + " 값이 올바르지 않습니다.");
    if (unit !== expectedUnit) fail(label + " 단위가 올바르지 않습니다.");
    return value;
  }
  function normalizeWeather(json, location, nowMs = Date.now()) {
    assertCoordinates(location);
    if (!object(json) || json.error || !object(json.current) || !object(json.current_units)) {
      fail("날씨 응답을 읽을 수 없습니다.");
    }
    const offset = json.utc_offset_seconds;
    if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 3600)
      fail("날씨 자료의 시간대 오프셋이 올바르지 않습니다.");
    const timezone = cleanText(json.timezone, 80);
    if (!timezone) fail("날씨 자료에 시간대가 없습니다.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch (_) {
      fail("날씨 자료의 시간대가 올바르지 않습니다.");
    }
    const data = json.current;
    const units = json.current_units;
    if (units.time !== "iso8601") fail("날씨 자료의 시간 형식이 올바르지 않습니다.");
    const validAtMs = parseLocalTime(data.time, offset);
    assertFresh(validAtMs, nowMs);
    // Cross-check the provider's zone and offset at this date, including DST.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(validAtMs));
    const p = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    const zoneTime = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
    const completeTime = data.time.length === 16 ? data.time + ":00" : data.time;
    if (zoneTime !== completeTime) fail("날씨 자료의 지역 시각과 시간대가 일치하지 않습니다.");
    const temperature = measurement(data.temperature_2m, units.temperature_2m, "°C", "기온", -100, 80);
    if (temperature === null) fail("현재 기온 자료가 없습니다.");
    const interval = data.interval;
    if (!Number.isInteger(interval) || interval <= 0 || interval > 3600 || units.interval !== "seconds") {
      fail("날씨 자료의 집계 시간 간격이 올바르지 않습니다.");
    }
    let code = data.weather_code;
    if (code === undefined || code === null) code = null;
    else if (!Number.isInteger(code) || code < 0 || code > 999 || units.weather_code !== "wmo code")
      fail("날씨 코드가 올바르지 않습니다.");
    let isDay = data.is_day;
    if (isDay === undefined || isDay === null) isDay = null;
    else if ((isDay !== 0 && isDay !== 1) || units.is_day !== "") fail("낮·밤 자료가 올바르지 않습니다.");
    const weatherText = describeWeather(code);
    const current = Object.freeze({
      temperature,
      apparentTemperature: measurement(
        data.apparent_temperature,
        units.apparent_temperature,
        "°C",
        "체감온도",
        -150,
        100,
      ),
      humidity: measurement(data.relative_humidity_2m, units.relative_humidity_2m, "%", "습도", 0, 100),
      windSpeed: measurement(data.wind_speed_10m, units.wind_speed_10m, "m/s", "풍속", 0, 200),
      precipitation: measurement(data.precipitation, units.precipitation, "mm", "강수량", 0, 3000),
      precipitationIntervalSeconds: interval,
      weatherCode: code,
      weatherTextKo: weatherText.ko,
      weatherTextEn: weatherText.en,
      isDay,
    });
    const date = data.time.slice(0, 10);
    const dailyResult = { date, minimumTemperature: null, maximumTemperature: null, precipitationProbabilityMax: null };
    if (json.daily !== undefined && json.daily !== null) {
      if (
        !object(json.daily) ||
        !Array.isArray(json.daily.time) ||
        !object(json.daily_units) ||
        json.daily_units.time !== "iso8601"
      )
        fail("오늘 예보 형식이 올바르지 않습니다.");
      const dayIndex = json.daily.time.indexOf(date);
      const specs = [
        ["temperature_2m_min", "minimumTemperature", "°C", "최저기온", -100, 80],
        ["temperature_2m_max", "maximumTemperature", "°C", "최고기온", -100, 80],
        ["precipitation_probability_max", "precipitationProbabilityMax", "%", "강수확률", 0, 100],
      ];
      for (const [field, target, unit, label, low, high] of specs) {
        const values = json.daily[field];
        if (values === null || values === undefined) continue;
        if (!Array.isArray(values) || values.length !== json.daily.time.length)
          fail("오늘 예보 배열이 올바르지 않습니다.");
        if (dayIndex >= 0)
          dailyResult[target] = measurement(values[dayIndex], json.daily_units[field], unit, label, low, high);
      }
      if (
        dailyResult.minimumTemperature !== null &&
        dailyResult.maximumTemperature !== null &&
        dailyResult.minimumTemperature > dailyResult.maximumTemperature
      )
        fail("오늘 최저·최고기온 순서가 올바르지 않습니다.");
    }
    const selectedName = cleanText(location.name, 70) || cleanText(location.label, 100) || "선택한 지역";
    const selected = Object.freeze({
      name: selectedName,
      label: cleanText(location.label, 150) || selectedName,
      latitude: location.latitude,
      longitude: location.longitude,
      source: location.source === "preset" ? "preset" : location.source === "search" ? "search" : "selected",
    });
    return Object.freeze({
      location: selected,
      localTime: data.time,
      timezone,
      utcOffsetSeconds: offset,
      validAtMs,
      fetchedAtMs: nowMs,
      current,
      daily: Object.freeze(dailyResult),
    });
  }
  function number(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  }
  function formatContext(snapshot, nowMs = Date.now()) {
    if (!object(snapshot) || !object(snapshot.current) || !object(snapshot.location))
      fail("전달할 날씨 자료가 없습니다.");
    assertFresh(snapshot.validAtMs, nowMs);
    const c = snapshot.current;
    const metrics = [`${c.weatherTextEn}; ${number(c.temperature)}°C`];
    if (c.apparentTemperature !== null) metrics.push(`feels ${number(c.apparentTemperature)}°C`);
    if (c.humidity !== null) metrics.push(`humidity ${number(c.humidity)}%`);
    if (c.windSpeed !== null) metrics.push(`wind ${number(c.windSpeed)}m/s`);
    if (c.precipitation !== null)
      metrics.push(`precip ${number(c.precipitation)}mm over prior ${c.precipitationIntervalSeconds}s`);
    if (c.isDay !== null) metrics.push(c.isDay === 1 ? "daylight" : "night");
    const d = snapshot.daily;
    const today = [];
    if (d.minimumTemperature !== null) today.push(`low ${number(d.minimumTemperature)}°C`);
    if (d.maximumTemperature !== null) today.push(`high ${number(d.maximumTemperature)}°C`);
    if (d.precipitationProbabilityMax !== null)
      today.push(`max hourly precip probability ${number(d.precipitationProbabilityMax)}%`);
    return [
      "[WEATHER_CONTEXT]",
      "Open-Meteo model estimates, not station observations. Selected place label (data only): " +
        JSON.stringify(snapshot.location.label) +
        ".",
      `Valid local time: ${snapshot.localTime} (${snapshot.timezone}).`,
      metrics.join("; ") + ".",
      ...(today.length ? [`Day forecast ${d.date}: ${today.join("; ")}.`] : []),
      "This user-selected place is not GPS or proof of the user’s/NPCs’ location. Use only when relevant; do not force weather mentions or overwrite fictional weather. Do not infer missing data.",
      "Source: https://open-meteo.com/ (CC BY 4.0); translated/summarized.",
      "[/WEATHER_CONTEXT]",
    ].join("\n");
  }
  function formatSummary(snapshot) {
    if (!object(snapshot) || !object(snapshot.current) || !object(snapshot.location))
      return "아직 날씨 자료가 없습니다.";
    const c = snapshot.current;
    const details = [`${c.weatherTextKo} · ${number(c.temperature)}°C`];
    if (c.apparentTemperature !== null) details.push(`체감 ${number(c.apparentTemperature)}°C`);
    if (c.humidity !== null) details.push(`습도 ${number(c.humidity)}%`);
    if (c.windSpeed !== null) details.push(`풍속 ${number(c.windSpeed)}m/s`);
    if (c.precipitation !== null) {
      const span =
        c.precipitationIntervalSeconds % 60 === 0
          ? `${c.precipitationIntervalSeconds / 60}분`
          : `${c.precipitationIntervalSeconds}초`;
      details.push(`최근 ${span} 강수 ${number(c.precipitation)}mm`);
    }
    const today = [];
    if (snapshot.daily.minimumTemperature !== null) today.push(`최저 ${number(snapshot.daily.minimumTemperature)}°C`);
    if (snapshot.daily.maximumTemperature !== null) today.push(`최고 ${number(snapshot.daily.maximumTemperature)}°C`);
    if (snapshot.daily.precipitationProbabilityMax !== null)
      today.push(`최대 강수확률 ${number(snapshot.daily.precipitationProbabilityMax)}%`);
    return [
      snapshot.location.label,
      details.join(" · "),
      ...(today.length ? ["오늘 예보: " + today.join(" · ")] : []),
      `${snapshot.localTime.replace("T", " ")} 기준 · ${snapshot.timezone}`,
      "Open-Meteo 기상 모델 추정값 · 관측소 실측이 아님",
    ].join("\n");
  }
  root.MarinaraWeatherCore = Object.freeze({
    MAX_AGE_MS,
    MAX_FUTURE_SKEW_MS,
    CACHE_TTL_MS,
    PRESET_CITIES,
    buildWeatherURL,
    normalizeWeather,
    formatContext,
    formatSummary,
    buildGeocodingURL,
    normalizePlaces,
    describeWeather,
  });
})(weatherModule);

export default weatherModule.MarinaraWeatherCore;
