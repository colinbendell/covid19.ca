const fs = require('fs');
const {context} = require('@adobe/helix-fetch');
const {fetch} = context({
  // rejectUnauthorized: false, // TODO: revert when data.ontario.ca fixes their certs
  h1: {keepAlive: true},
  h2: {idleSessionTimeout: 1*1000}
})
const {stringify} = require('./stringify.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const provinces = ['CA','AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const provinceLookup = new Map([
  ['Total forecasted allocations','CA'],
  ['Alberta','AB'], ['Canada', 'CA'],
  ['British Columbia','BC'],['Manitoba','MB'],['New Brunswick','NB'],['Newfoundland and Labrador','NL'],
  ['Nova Scotia','NS'],['Northwest Territories','NT'],['Nunavut','NU'],['Ontario','ON'],['Prince Edward Island','PE'],
  ['Quebec','QC'],['Saskatchewan','SK'],['Yukon','YT']
]);

function removeEmpty(obj) {
    if (Array.isArray(obj)) {
        return obj.map(v => removeEmpty(v));
    }
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([_, v]) => v !== null)
            // .filter(([k, v]) => !(/^change_/.test(k) && v === 0))
            .map(([k, v]) => [k, v === Object(v) && !(v instanceof Date) ? removeEmpty(v) : v])
    );
}

function mergeDaily(srcDaily = [], newDaily = [], force = false) {
  if (!srcDaily) srcDaily = [];
  if (!newDaily) newDaily = [];

  const [lastDate] = srcDaily.map(d => d.date).sort((a, b) => Date.parse(a) - Date.parse(b)).slice(-1);

  for (const newDay of newDaily) {
    const srcDay = srcDaily.filter(r => r.date === newDay.date)[0];
    if (srcDay) {
      if (force || newDay.date === lastDate) {
        for (const key of Object.keys(newDay).filter(n => !srcDay[n])) {
          srcDay[key] = newDay[key];
        }
      }
    }
    else {
      srcDaily.push(newDay);
    }
  }
  return srcDaily;
}

async function get(url) {
  try {
    const res = await fetch(url,
      {
        'headers': {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36',
        },
        redirect: 'manual',
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

async function getVaccineAgeBreakdown() {

  const res = await get('https://health-infobase.canada.ca/src/data/covidLive/vaccination-coverage-byAgeAndSex.csv');
  const lines = res.split(/[\r\n]+/g);
  const header = lines.shift();
  const headerRows = header.split(/\s*,\s*/g) || [];
  const headerIndex = new Map([["prename", 0],["week_end", 0],["sex", 0],["age", 0],["numtotal_atleast1dose", 0],["numtotal_partially", 0],["numtotal_fully", 0]]);
  for (const i in headerRows) {
    if (headerIndex.has(headerRows[i])) {
      headerIndex.set(headerRows[i], i);
    }
  }

  const data = new Map();
  for (const row of lines) {
    const values = row.split(/\s*,\s*/g) || [];
    if (values.length < 11) continue;

    const fullName = values[headerIndex.get('prename')];
    const name = provinceLookup.get(fullName) || fullName;
    const week = values[headerIndex.get('week_end')];
    const sex = values[headerIndex.get('sex')];
    const age = values[headerIndex.get('age')];
    const half = values[headerIndex.get('numtotal_atleast1dose')];
    // const half = values[headerIndex.get('numtotal_partially')];
    const full = values[headerIndex.get('numtotal_fully')];
    const doses = (Number.parseInt(half) || 0) + (Number.parseInt(full) || 0);

    if (!/^\d+/.test(age)) continue;
    if (!(Number.parseInt(half) > 0)) continue;

    if (!data.has(name)) data.set(name, new Map());
    const nameData = data.get(name);

    if (!nameData.has(week)) nameData.set(week, new Map());
    const weekData = nameData.get(week);

    if (!weekData.has(age)) weekData.set(age, {});
    const entry = weekData.get(age);
    if (!weekData.has('total')) weekData.set('total', {});
    const fullEntry = weekData.get('total');

    entry.doses = (entry.doses || 0) + (Number.parseInt(doses) || 0);
    entry.half = (entry.half || 0) + (Number.parseInt(half) || 0);
    entry.full = (entry.full || 0) + (Number.parseInt(full) || 0);
    fullEntry.doses = (fullEntry.doses || 0) + (Number.parseInt(doses) || 0);
    fullEntry.half = (fullEntry.half || 0) + (Number.parseInt(half) || 0);
    fullEntry.full = (fullEntry.full || 0) + (Number.parseInt(full) || 0);
  }

  // for (const province of data.keys()) {
  //   const dates = [...data.get(province).keys()].sort((a, b) => Date.parse(a) - Date.parse(b));
  //   for (const i in dates) {
  //     if (i === "0") continue;
  //
  //     const prev = data.get(province).get(dates[i-1]);
  //     const curr = data.get(province).get(dates[i]);
  //     for (const age of curr.keys()) {
  //       const ageData = curr.get(age);
  //       const prevAgeData = prev.get(age);
  //       if (!prevAgeData) continue;
  //
  //       for (const key of Object.keys(curr.get(age))) {
  //         ageData["change_" + key] = ageData[key] - (prevAgeData[key] || 0);
  //         if (prevAgeData["change_" + key]) {
  //           ageData["change_change_" + key] = ageData["change_" +key] - (prevAgeData["change_" + key] || 0);
  //         }
  //         if (age !== "total" && curr.get("total")[key]) {
  //           ageData["pct_" + key] = Math.round(ageData[key] / curr.get("total")[key] * 100 * 100) / 100;
  //         }
  //       }
  //     }
  //   }
  // }
  // console.log(stringify(data, 2, 200))
  fs.writeFileSync('_data/canada.ca/vaccination-coverage-byAgeAndSex.json', stringify(data, 2, 200));
}

async function getVaccineScheduleCanada() {
  const newValues = {};
  const res = await get('https://www.canada.ca/en/public-health/services/diseases/2019-novel-coronavirus-infection/prevention-risks/covid-19-vaccine-treatment/vaccine-rollout.html');

  for (const tableMatch of res.replace(/&nbsp;/g, ' ').matchAll(/<h2 id="a4[a-z][^<]*?<\/h2>.*?<table.*?<\/table>/isg)) {
    const table = new Map();
    const [match] = tableMatch || [];

    let lastModified;
    if (/Total COVID-19 vaccine confirmed distribution as of /.test(match)) {
      const [,lastModifiedDate, lastModifiedTime] = /Total COVID-19 vaccine confirmed distribution as of (.*?) at (\d+:\d+ \S+)/i.exec(match) || [];
      // lastModified = new Date(`${new Date(lastModifiedDate).toISOString().split('T')[0]} ${lastModifiedTime.replace('.', '')} EDT`);
      lastModified = (new Date(lastModifiedDate) || new Date()).toISOString().split('T')[0];
    }

    const [,title] = /<h2[^>]+>([^<]+)<\/h2>/i.exec(match) || [];
    const titleClean = title.replace(/(?: vaccine)? forecasted allocation/i, '').replace(/ distribution/i, '');
    const [thead] = /<thead[^>]*>.*?<\/thead>/ism.exec(match) || [];

    const header = [];
    for (const thMatch of thead.matchAll(/<th[^>]*>(?:<[^>]+>)*([^<]+)(?:<\/[^>]+>)*<\/th>/g)) {
      const [,th] = thMatch;
      const thClean = th.trim()
        .replace(/Pfizer.*/, 'Pfizer')
        .replace(/Distribution location/, 'name')
        .replace(/Vaccine distribution/, 'name')
        .replace(/Total forecasted allocations/, 'total')
        .replace(/^(\d+)(?:[ –-]*\d+)?\s*([a-z]+).*/i, '2021-$2-$1');
      header.push(Date.parse(thClean) ? new Date(thClean)?.toISOString()?.split('T')[0] : thClean);
    }

    const [tbody] = /<tbody[^>]*>.*?<\/tbody>/is.exec(match) || [];
    for (const trMatch of tbody.matchAll(/<tr[^>]*>.*?<\/tr>/isg)) {
      const [tr] = trMatch || "";
      let i = 0;
      const row = {};
      for (const tdMatch of tr.matchAll(/<td[^>]*>(.*?)<\/td>/ig)) {
        const [,td] = tdMatch || "";
        const tdClean = td.replace(/<.*/, '').replace(/\s+/g, ' ').trim()
          .replace(/Federal allocation.*/, 'FA')
          .replace(/Total distributed in Canada/, 'CA')
          .replace(/,/g, '');
        row[header[i++]] = provinceLookup.get(tdClean) || Number.parseInt(tdClean) || (tdClean === "0" ? 0 : tdClean);
      }

      const name = row.name;
      delete row.name;
      table.set(name, row);
    }

    // blech this is gross. TODO: cleanup
    if (titleClean !== 'Vaccine') {
      // we need to reorganize
      const newRow = new Map();
      for (const [name, row] of [...table.entries()]) {
        for (const [date, value] of Object.entries(row)) {
          if (!table.has(date)) table.set(date, {date: date});
          table.get(date)[name] = value;
        }
        table.delete(name);
      }
      newValues[titleClean] = [...table.values()];
    }
    else {
      newValues.daily = [Object.assign(Object.fromEntries(table.entries()), {date: lastModified})];
    }
  }

  const dataFilename = '_data/canada.ca/vaccine-rollout.json';
  if (fs.existsSync(dataFilename)) {
    const oldValues = JSON.parse(fs.readFileSync(dataFilename, 'utf-8'));
    newValues.daily.push(...oldValues.daily.filter(d => d.date !== newValues?.daily[0].date));
  }
  fs.writeFileSync('_data/canada.ca/vaccine-rollout.json', stringify(newValues, 2, 200));
}

async function getStatsCanCensus(data, hrData) {
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
  const statsCanada = JSON.parse(fs.readFileSync('_data/statcan.gc.ca/1710000901.json', 'utf-8'));
  for (const prov of statsCanada) {
    prov.population = Math.max(prov.population || 0, data.get(prov.code)?.population || 0)
    data.set(prov.code, Object.assign(data.get(prov.code) || {}, prov));
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
  data.set('CA', {name: "Canada", population: 38131104});
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
  const res = await get('https://api.covid19tracker.ca/reports?after=2020-03-01&fill_dates=true').catch(e => null);
  if (res) {
    data.get('CA').daily = mergeDaily(res.data, data.get('CA').daily).sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
    // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
    if (res.last_updated) data.get('CA').updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
  }
}
async function getCovid19TrackerProvinceDaily(code = 'ON', data = new Map()) {
  // fill in the historical daily data per province
  const res = await get(`https://api.covid19tracker.ca/reports/province/${code}?after=2020-12-10&fill_dates=true`);
  if (res) {
    data.get(code).daily = mergeDaily(res.data, data.get(code).daily).sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
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
        console.log("missing:", r);
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
      r.daily = mergeDaily(regionDaily.data, r.daily);
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

/**
 * Saskatchewan Actuals
 */
async function getSK(hrData) {
  // convenience remapping of field names to the common form
  const keyMap = new Map([
    ["Date", "date"],
    ["New Cases", "change_cases"],
    ["New Tests", "change_tests"],
    ["Active Cases", "active_cases"],
    ["Total Cases", "total_cases"],
    ["Total Tests", "total_tests"],
    ["Inpatient Hospitalizations", "total_inpatient"],
    ["ICU Hospitalizations", "total_criticals"],
    ["Recovered Cases", "total_recoveries"],
    ["Deaths", "total_fatalities"],
    ["# of Patients with Tests Ordered", "total_hospital_tests"],
    ["# Patients Confirmed Negative", "total_hospital_neg_tests"],
    ["Total First Vaccine Doses", "total_first_vaccination"],
    ["Total Second Vaccine Doses", "total_vaccinated"],
    ["Total Vaccine Doses", "total_vaccinations"],
    ["New First Vaccine Doses", "change_first_vaccination"],
    ["New Second Vaccine Doses", "change_vaccinated"],
    ["New Vaccine Doses", "change_vaccinations"]
  ]);
  const hrName = new Map([...hrData.values()].map(hr => [hr.name, hr]));
  const skHR = new Map();
  await Promise.all(
    // TODO: https://dashboard.saskatchewan.ca/api/indicator/detail/health-wellness%3Acovid-19-vaccines%3Avaccines
    // TODO: https://dashboard.saskatchewan.ca/api/indicator/detail/health-wellness%3Acovid-19-vaccines%3Avaccines?legacyRegions=true
    [ "https://dashboard.saskatchewan.ca/health-wellness/covid-19/cases",
      "https://dashboard.saskatchewan.ca/health-wellness/covid-19-tests/tests",
      "https://dashboard.saskatchewan.ca/health-wellness/covid-19-vaccines/vaccines"]
      .map(async url => {
        const html = await get(url);
        const label = url.replace(/.*\//, '');
        const [,jsonURL] = /<a href=["']([^"']+)["']>JSON<\/a>/m.exec(html) || [];
        if (jsonURL) {
          const data = await get(`https://dashboard.saskatchewan.ca${jsonURL}`);
          for (const row of data) {
            // we are only going to keep the macro region details, since the reliability of the sub region data is questionable
            row.Region = row.Region.replace(/(Far North|North|Central|Saskatoon|Regina|South).*/, '$1');
            //init data types to use the common format. For some reason SK doesn't use ISO8601 and invented their own
            row.Date = row.Date.replace(/\//g, '-');
            if (!skHR.has(row.Region)) skHR.set(row.Region, new Map());
            if (!skHR.get(row.Region).has(row.Date)) skHR.get(row.Region).set(row.Date, {date: row.Date});

            const last = skHR.get(row.Region).get(row.Date);
            const keys = [...Object.keys(row)];
            for (const key of keys) {
              const newKey = keyMap.get(key) || key.toLowerCase().replace(/^\W+/, '').replace(/ /g, '_');
              // only propagate INT fields
              if (row[key] > Number.MIN_VALUE || last[newKey] > Number.MIN_VALUE) {
                last[newKey] = (Number.parseInt(last[newKey]) || 0) + (Number.parseInt(row[key]) || 0);
              }
            }
          }

          for (const region of [...skHR.values()]) {
            let last = null
            for (const d of [...region.values()].sort((a,b) => Date.parse(a.date) - Date.parse(b.date))) {
              // calculate missing fields to match aggregate datasets
              d.total_hospitalizations = (d.total_inpatient || 0) + (d.total_criticals || 0);
              if (last) {
                d.change_recoveries = (d.total_recoveries || 0) - (last.total_recoveries || 0);
                d.change_criticals = (d.total_criticals || 0) - (last.total_criticals || 0);
                d.change_fatalities = (d.total_fatalities || 0) - (last.total_fatalities || 0);
                d.change_hospitalizations = (d.total_hospitalizations || 0) - (last.total_hospitalizations || 0);
              }
              last = d;

              // change_vaccines_distributed
              // total_vaccines_distributed
            }
          }
        }
      })
  );
  for (const region of skHR.keys()) {
    hrName.get(region)._daily = [...skHR.get(region).values()];
  }
}

/**
 * Ontario Actuals
 */
async function getON(data, hrData) {
  const onDaily = [];
  await Promise.all([
    async () => {
      // cases by health region
      const res = await get('https://data.ontario.ca/api/3/action/datastore_search?resource_id=d1bfe1ad-6575-4352-8302-09ca81f7ddfc&limit=999999');
      const phuData = new Map();
      for (const hr of hrData.values()) {
        if (hr.phu_id) phuData.set(hr.phu_id, hr);
      }

      for (const r of res?.result?.records) {
        // some null values in the recordset
        if (r.PHU_NUM) {
          if (!phuData.has(r.PHU_NUM)) phuData.set(r.PHU_NUM, {id: r.PHU_NUM, name: r.PHU_NAME});
          const phu = phuData.get(r.PHU_NUM);
          if (!phu.daily) phu.daily = [];

          phu.daily.push({
            date: r.FILE_DATE.split('T')[0],
            active_cases: r.ACTIVE_CASES,
            total_recoveries: r.RESOLVED_CASES,
            total_fatalities: r.DEATHS});
        }
      }

      for (const phu of phuData.values()) {
        let last = null
        for (const d of phu.daily.sort((a,b) => Date.parse(a.date) - Date.parse(b.date))) {
          // calculate missing fields to match aggregate datasets
          // d.total_hospitalizations = (d.total_inpatient || 0) + (d.total_criticals || 0);
          if (last) {
            d.change_recoveries = (d.total_recoveries || 0) - (last.total_recoveries || 0);
            // d.change_criticals = (d.total_criticals || 0) - (last.total_criticals || 0);
            d.change_fatalities = (d.total_fatalities || 0) - (last.total_fatalities || 0);
            // d.change_hospitalizations = (d.total_hospitalizations || 0) - (last.total_hospitalizations || 0);
            d.change_cases = (d.active_cases || 0) - ((last.active_cases || 0) - d.change_recoveries - d.change_fatalities);
          }
          last = d;
        }
      }
      //cleanup
      for (const phu of phuData.values()) {
        for (const d of phu.daily) {
          delete d.active_cases;
        }
      }
      // fs.writeFileSync('_data/data.ontario.ca/d1bfe1ad-6575-4352-8302-09ca81f7ddfc.json', stringify([...phuData.values()], 2, 200));
    },
    async () => {
      const res = await get('https://data.ontario.ca/api/3/action/datastore_search?resource_id=8a89caa9-511c-4568-af89-7f2174b4378c&limit=9999');
      const daily = [];
      for (const r of res?.result?.records) {
        daily.push({
          date: r.report_date.split('T')[0],
          change_vaccinations: Number.parseInt(r.previous_day_doses_administered?.toString()?.replace(/,/g, '')),
          total_vaccinations: Number.parseInt(r.total_doses_administered?.toString()?.replace(/,/g, '')),
          total_vaccinated: Number.parseInt(r.total_individuals_fully_vaccinated?.toString()?.replace(/,/g, ''))
        });
      }

      let last = null;
      for (const d of daily.sort((a,b) => Date.parse(a.date) - Date.parse(b.date))) {
        if (last) {
          d.change_vaccinated = (d.total_vaccinated || 0) - (last.total_vaccinated || 0);
        }
        last = d;
      }

      mergeDaily(onDaily, daily, true);
      // fs.writeFileSync('_data/data.ontario.ca/8a89caa9-511c-4568-af89-7f2174b4378c.json', stringify(daily, 2, 200));
    },
    async () => {
      const res = await get('https://data.ontario.ca/api/3/action/datastore_search?resource_id=ed270bb8-340b-41f9-a7c6-e8ef587e6d11&limit=9999');
      const daily = [];
      for (const r of res?.result?.records) {
        if (r["Total Cases"]) {
          daily.push({
            date: r["Reported Date"].split('T')[0],
            total_cases: r["Total Cases"],
            total_recoveries: r["Resolved"],
            total_fatalities: r["Deaths"],
            total_hospitalizations: r["Number of patients hospitalized with COVID-19"],
            total_criticals: r["Number of patients in ICU due to COVID-19"],
            total_tests: r["Total patients approved for testing as of Reporting Date"],
            change_tests: r["Total tests completed in the last day"],
          });
        }
      }

      let last = null;
      for (const d of daily.sort((a,b) => Date.parse(a.date) - Date.parse(b.date))) {
        if (last) {
          d.change_cases = (d.total_cases || 0) - (last.total_cases || 0);
          d.change_recoveries = (d.total_recoveries || 0) - (last.total_recoveries || 0);
          d.change_fatalities = (d.total_fatalities || 0) - (last.total_fatalities || 0);
          d.change_hospitalizations = (d.total_hospitalizations || 0) - (last.total_hospitalizations || 0);
          d.change_criticals = (d.total_criticals || 0) - (last.total_criticals || 0);
        }
        last = d;
      }

      mergeDaily(onDaily, daily, true);
      // fs.writeFileSync('_data/data.ontario.ca/ed270bb8-340b-41f9-a7c6-e8ef587e6d11.json', stringify(daily, 2, 200));
    }
  ].map(async p => await p()));

  const onData = data.get('ON');
  if (!onData.daily) onData.daily = [];
  mergeDaily(onData.daily, onDaily);

  // vaccine for ontario
  // https://data.ontario.ca/api/3/action/datastore_search?resource_id=8a89caa9-511c-4568-af89-7f2174b4378c&limit=9999


  // Test Data
  // https://data.ontario.ca/dataset/ontario-covid-19-testing-metrics-by-public-health-unit-phu/resource/07bc0e21-26b5-4152-b609-c1958cb7b227
}

async function getData() {
  const data = new Map();
  const hrData = new Map();

  await getVaccineAgeBreakdown();
  await getVaccineScheduleCanada();
  await getCovid19TrackerProvinces(data);
  await getStatsCanCensus(data, hrData);
  await getSK(hrData);
  await getON(data, hrData);

  await Promise.all([
    // getCovid19TrackerCanadaTotals(data),
    // getCovid19TrackerProvincesTotals(data),
    // getCovid19TrackerRegionTotals(hrData),
    getCovid19TrackerCanadaDaily(data),
    getCovid19TrackerSources(hrData),
  ]);

  const provinces = [...data.keys()].filter(code => !['CA', 'FA', '_RC'].includes(code));
  await Promise.all(provinces.map(code => getCovid19TrackerProvinceDaily(code, data)));
  await Promise.all(provinces.map(code => getCovid19TrackerProvinceRegions(code, data, hrData)));
  await Promise.all(provinces.map(code => getCovid19TrackerRegionDaily(code, data)));

  const canadaAdjPopulationRate = data.get('CA').population / data.get('CA').population2016;
  for (const prov of data.values()) {
    const adjPopulationRate = Math.max((prov.population / prov.population2016) || 0, canadaAdjPopulationRate) ;
    for (const hr of prov.regions || []) {
      if (hr.population2021) {
        hr.population = hr.population2021;
      }
      else if (hr.population) {
        hr.population = Math.round(hr.population * adjPopulationRate);
      }
      delete hr.phu_id;
    }
    delete prov.population2016;
    delete prov.population2021;
  }

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
