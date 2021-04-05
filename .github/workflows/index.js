const fs = require('fs');
const {context} = require('@adobe/helix-fetch');
const {fetch} = context({
    h1: {keepAlive: true},
    h2: {idleSessionTimeout: 1*1000}
})
const {stringify} = require('./stringify.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


const provinces = ['CA','AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];

function removeEmpty(obj) {
    if (Array.isArray(obj)) {
        return obj.map(v => removeEmpty(v));
    }
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([_, v]) => v !== null)
            .map(([k, v]) => [k, v === Object(v) && !(v instanceof Date) ? removeEmpty(v) : v])
    );
}

async function get(url) {
    try {
        const res =  await fetch(url,
        {
            "headers": {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
                "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "none",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",
            },
            redirect: "manual"
        });
        if (res.status === 429) {
            const retry = res.headers.get('retry-after') || 1;
            await res.arrayBuffer();
            console.error(`sleep ${retry}s: ${url}`);

            await sleep(retry * 1000 + 500);
            return get(url);
        }
        if (res.status !== 200) {
            await res.arrayBuffer();
            return {};
        }
        if (/json/.test(res.headers.get('content-type'))) {
          return await res.json();
        }

        return await res.text();
    }
    catch (e) {
        console.error(url);
        console.error(e);
        // if (/ECONNRESET/.test(e.message)) {
        //     await sleep(10000);
        //     return get(url);
        // }
    }
}

async function getCovid19TrackerProvinces(data = new Map()) {
  const provinces = await get('https://api.covid19tracker.ca/provinces');
  if (provinces){
    for (const prov of provinces) {
      const code = prov.code;
      delete prov.code;
      delete prov.id;
      data.set(code, prov);
    }
  }
  data.set('CA', {name: "Canada", population: 38008005});
  data.delete('_RC');
  data.delete('FA');
}
async function getCovid19TrackerCanadaTotals(data = new Map()) {
  // high level totals for the country
  const res = await get('https://api.covid19tracker.ca/summary');
  if (res) {
    data.get('CA').total = res.data[0];
    // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
    if (res.last_updated) data.get('CA').total.updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
  }
}
async function getCovid19TrackerProvincesTotals(data = new Map()) {
  // high level totals per province
  const res = await get('https://api.covid19tracker.ca/summary/split');
  for (const prov of res?.data || []) {
    const code = prov.province;
    delete prov.province;
    if (data.has(code)) {
      data.get(code).total = prov;
      // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
      if (res.last_updated) data.get(code).total.updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
    }
  }
}
// high level totals for each health region
async function getCovid19TrackerRegionTotals(hrData = new Map()) {
  const res = await get('https://api.covid19tracker.ca/summary/split/hr');
  for (const hr of res?.data || []) {
    const id = hr.hr_uid;
    delete hr.hr_uid;
    if (!hrData.has(id)) hrData.set(id, {});
    hrData.get(id).total = hr;
  }
}
async function getCovid19TrackerSources(data = new Map()) {
  // grab the current status of the cases
  const res = await get('https://api.covid19tracker.ca/cases');
  for (const prov of res?.data || []) {
    const code = prov.province;
    delete prov.province;
    if (data.has(code)) {
      data.get(code).cases = prov;
      // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
      if (res.last_updated) data.get(code).cases.updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
    }
  }
}
async function getCovid19TrackerCanadaDaily(data = new Map()) {
  // fill in the historical daily data for the country
  const res = await get('https://api.covid19tracker.ca/reports?after=2020-12-10&fill_dates=true').catch(e => null);
  if (res) {
    data.get('CA').daily = res.data.sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
    // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
    if (res.last_updated) data.get('CA').updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
  }
}
async function getCovid19TrackerProvinceDaily(code = 'ON', data = new Map()) {
  // fill in the historical daily data per province
  const res = await get(`https://api.covid19tracker.ca/reports/province/${code}?after=2020-12-10&fill_dates=true`);
  if (res) {
    data.get(code).daily = res.data;
    // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
    if (res.last_updated) data.get(code).updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
  }
}
async function getCovid19TrackerProvinceRegions(code = 'ON', data = new Map(), hrData = new Map()) {
  // populate sub region data. hr_uid (generally) matches stats canada IDs, so we can marry the demographic data
  // first we need to map the regions to the province since the /hr/split data doesn't provide the association
  const regions = await get(`https://api.covid19tracker.ca/province/${code}/regions`);
  if (regions) {
    data.get(code).regions = regions.map(r => {
      if (!hrData.has(r.hr_uid)) {
        console.log(r);
        hrData.set(r.hr_uid, r);
      }
      else {
        r = Object.assign(hrData.get(r.hr_uid), r);
      }

      if (r.id && r.hr_uid) r.id = r.hr_uid;
      delete r.hr_uid;

      if (!r.name && r.engname) r.name = r.engname;
      if (r.engname && r.frname && r.engname !== r.frname) {
        r.name = {en: r.name}
        if (r.frename) r.name.fr = r.frename;
      }
      delete r.engname;
      delete r.frename;

      return r;
    });
  }
}

async function getCovid19TrackerRegionDaily(code, data) {
  await Promise.all(data.get(code).regions.map(async r => {
    const daily = new Map(r?._daily?.map(d => [d.date, d]) || []);
    const regionDaily = await get(`https://api.covid19tracker.ca/regions/${r.id}/reports?after=2020-12-10&fill_dates=true`);
    if (regionDaily) {
      r.daily = regionDaily.data;
      for (const day of r.daily) {
        if (daily.has(day.date)) {
          Object.assign(day, daily.get(day.date));
          daily.delete(day.date);
        }
      }
      r.daily.push(...daily.values());
      delete r._daily;

      r.daily = r.daily.sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
      // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
      if (regionDaily.last_updated) r.updated_at =  new Date(regionDaily.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
    }
  }));
}

async function getStatsCanCensus(hrData) {
  // const statsCanData = new Map();
  // const statcanGeosProvinces = await get('https://www12.statcan.gc.ca/rest/census-recensement/CR2016Geo.json?geos=PR');
  // for (const prov of statcanGeosProvinces?.DATA || []) {
  //     statsCanData.set(prov[0], {name:prov[2]});
  // }
  // const statcanGeosHealthRegions = await get('https://www12.statcan.gc.ca/rest/census-recensement/CR2016Geo.json?geos=HR');
  // await Promise.all(statcanGeosHealthRegions.DATA.map(async hr => {
  //     const res = await get(`https://www12.statcan.gc.ca/rest/census-recensement/CPR2016.json?dguid=${hr[0]}&topic=13`);
  //     // Population, 2016 === TEXT_ID = 1000 & HIER_ID = 1.1.1
  //     let textID = 0;
  //     let hierID = 0;
  //     let tData = 0;
  //     let regionID = 0;
  //     let name = 0;
  //     for (const i in res?.COLUMNS || []) {
  //         if (res.COLUMNS[i] === "GEO_ID") regionID = i;
  //         if (res.COLUMNS[i] === "GEO_NAME_NOM") name = i;
  //         if (res.COLUMNS[i] === "TEXT_ID") textID = i;
  //         if (res.COLUMNS[i] === "HIER_ID") hierID = i;
  //         if (res.COLUMNS[i] === "T_DATA_DONNEE") tData = i;
  //     }
  //     const hrPop = res?.DATA?.filter(v => v[textID] === 1000 && v[hierID] === "1.1.1").map(v => ({id: v[regionID], population: v[tData], name: v[name]})).pop();
  //     if (hrPop) hrData.set(Number.parseInt(hrPop.id), hrPop);
  // }))

  // Stats Canada APIs are unreliable and are down all the time. Better to use a stashed version since this is based on 2016/2017 census data
  const statsCanadaHR = JSON.parse(fs.readFileSync('_data/statcan.gc.ca/statscanada-hr2017.json', 'utf-8'));
  for (const hr of statsCanadaHR) {
    hrData.set(Number.parseInt(hr.id), hr);
  }
}

//Saskatchewan Actuals
async function getSK(hrData) {
  // "change_cases": 1154,
  //       "change_criticals": 4,
  //       "change_fatalities": 9,
  //       "change_hospitalizations": 1,
  //       "change_recoveries": 893,
  //       "change_tests": 0,
  //       "change_vaccinated": 0,
  //       "change_vaccinations": 41194,
  //       "change_vaccines_distributed": 135100,
  //       "total_cases": 316112,
  //       "total_criticals": 128,
  //       "total_fatalities": 10693,
  //       "total_hospitalizations": 502,
  //       "total_recoveries": 295453,
  //       "total_tests": 7619690,
  //       "total_vaccinations": 1529541,
  //       "total_vaccines_distributed": 2127605,
  const keyMap = new Map([
    ["Date", "date"],
    ["New Cases", "change_cases"],
    ["Total Cases", "total_cases"],
    ["Active Cases", "active_cases"],
    ["Inpatient Hospitalizations", "total_inpatient"],
    ["ICU Hospitalizations", "total_criticals"],
    ["Recovered Cases", "total_recoveries"],
    ["Deaths", "total_fatalities"],
    ["# of Patients with Tests Ordered", "total_hospital_tests"],
    ["# Patients Confirmed Negative", "total_hospital_neg_tests"],
    ["Total Tests", "total_tests"],
    ["New Tests", "change_tests"]
  ]);
  const hrName = new Map([...hrData.values()].map(hr => [hr.name, hr]));
  const skHR = new Map();
  await Promise.all(
    [ "https://dashboard.saskatchewan.ca/health-wellness/covid-19/cases", "https://dashboard.saskatchewan.ca/health-wellness/covid-19-tests/tests"]
      .map(async url => {
        const html = await get(url);
        const label = url.replace(/.*\//, '');
        const [,jsonURL] = /<a href=["']([^"']+)["']>JSON<\/a>/m.exec(html) || [];
        if (jsonURL) {
          const data = await get(`https://dashboard.saskatchewan.ca${jsonURL}`);
          for (const row of data) {
            row.Region = row.Region.replace(/(Far North|North|Central|Saskatoon|Regina|South).*/, '$1');
            row.Date = row.Date.replace(/\//g, '-');
            if (!skHR.has(row.Region)) skHR.set(row.Region, new Map());
            if (!skHR.get(row.Region).has(row.Date)) skHR.get(row.Region).set(row.Date, {date: row.Date});

            const last = skHR.get(row.Region).get(row.Date);
            const keys = [...Object.keys(row)];
            for (const key of keys) {
              const newKey = keyMap.get(key) || key.toLowerCase().replace(/^\W+/, '').replace(/ /g, '_');
              // delete Object.assign(row, {[newKey]: row[key] })[key];
              if (row[key] > Number.MIN_VALUE || last[newKey] > Number.MIN_VALUE) {
                last[newKey] = (Number.parseInt(last[newKey]) || 0) + (Number.parseInt(row[key]) || 0);
              }
            }
            // if (row.Region === 'Saskatoon' && row.Date === '2021-04-04') console.log(row, last);
            // delete row.region;
          }

          // calculate missing fields
          for (const region of [...skHR.values()]) {
            for (const d of [...region.values()]) {
              d.total_hospitalizations = (d.total_inpatient || 0) + (d.total_criticals || 0);
            }
          }
        }
      })
  );
  for (const region of skHR.keys()) {
    hrName.get(region)._daily = [...skHR.get(region).values()];
  }
}

async function getData() {
  const data = new Map();
  const hrData = new Map();

  await getCovid19TrackerProvinces(data);
  await getStatsCanCensus(hrData);
  await getSK(hrData);

  await Promise.all([
    getCovid19TrackerCanadaTotals(data),
    getCovid19TrackerProvincesTotals(data),
    getCovid19TrackerRegionTotals(hrData),
    getCovid19TrackerCanadaDaily(data),
    getCovid19TrackerSources(hrData),
  ]);

  const provinces = [...data.keys()].filter(code => !['CA', 'FA', '_RC'].includes(code));
  await Promise.all(provinces.map(code => getCovid19TrackerProvinceDaily(code, data)));
  await Promise.all(provinces.map(code => getCovid19TrackerProvinceRegions(code, data, hrData)));
  await Promise.all(provinces.map(code => getCovid19TrackerRegionDaily(code, data)));

  const json = stringify(removeEmpty(Object.fromEntries(data.entries())), 2, 200);
  fs.writeFileSync('_data/covid19tracker.ca/data.json', json);
}

getData();

// SK Tests:
// https://dashboard.saskatchewan.ca/export/tests/2546.json
// https://dashboard.saskatchewan.ca/export/cases/2544.json

// ON Totals:
// https://data.ontario.ca/dataset/f4f86e54-872d-43f8-8a86-3892fd3cb5e6/resource/ed270bb8-340b-41f9-a7c6-e8ef587e6d11/download/covidtesting.csv
// ON: Change of Active by PHU:
// https://data.ontario.ca/dataset/f4f86e54-872d-43f8-8a86-3892fd3cb5e6/resource/8a88fe6d-d8fb-41a3-9d04-f0550a44999f/download/daily_change_in_cases_by_phu.csv
// ON: All Cases by PHU
// https://data.ontario.ca/dataset/f4112442-bdc8-45d2-be3c-12efae72fb27/resource/455fd63b-603d-4608-8216-7d8647f43350/download/conposcovidloc.csv
// ON: PHU change in active, resolved, deaths:
// https://data.ontario.ca/dataset/1115d5fe-dd84-4c69-b5ed-05bf0c0a0ff9/resource/d1bfe1ad-6575-4352-8302-09ca81f7ddfc/download/cases_by_status_and_phu.csv
// ON: Ontario Vaccinations
// https://data.ontario.ca/en/dataset/covid-19-vaccine-data-in-ontario/resource/8a89caa9-511c-4568-af89-7f2174b4378c
