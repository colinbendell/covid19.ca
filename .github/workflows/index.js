const fs = require('fs');
const {context} = require('@adobe/helix-fetch');
const {fetch} = context({
    h1: {keepAlive: true}
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
            console.error(`sleep ${retry}s: ${url}`);

            await sleep(retry * 1000 + 500);
            return get(url);
        }
        if (res.status !== 200) {
            const data = await res.arrayBuffer();
            return {};
        }
        const json = await res.json();
        return json;
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
async function getData() {
    const data = new Map();
    const hrData = new Map();
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
        hrData.set(Number.parseInt(hr.id), hr)
    }

    await Promise.all([

        // high level totals for each health region
        get('https://api.covid19tracker.ca/summary/split/hr').then(res => {
            for (const hr of res?.data || []) {
                const id = hr.hr_uid;
                delete hr.hr_uid;
                if (!hrData.has(id)) hrData.set(id, {});
                Object.assign(hrData.get(id), {total: hr});
            }
        }),

        // high level totals for the country
        get('https://api.covid19tracker.ca/summary').then(res => {
            if (res) {
                data.get('CA').total = res.data[0];
                // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
                if (res.last_updated) data.get('CA').total.updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
            }
        }),

        // high level totals per province
        get('https://api.covid19tracker.ca/summary/split').then(res => {
            for (const prov of res?.data || []) {
                const code = prov.province;
                delete prov.province;
                if (data.has(code)) {
                    data.get(code).total = prov;
                    // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
                    if (res.last_updated) data.get(code).total.updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
                }
            }
        }),

        // grab the current status of the cases
        get('https://api.covid19tracker.ca/cases').then(res => {
            for (const prov of res?.data || []) {
                const code = prov.province;
                delete prov.province;
                if (data.has(code)) {
                    data.get(code).cases = prov;
                    // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
                    if (res.last_updated) data.get(code).cases.updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
                }
            }
        }),

        // fill in the historical daily data for the country
        get('https://api.covid19tracker.ca/reports?after=2020-12-10&fill_dates=true').then(res => {
            if (res) {
                data.get('CA').daily = res.data.sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
                // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
                if (res.last_updated) data.get('CA').updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
            }
        }).catch(e => null),
    ]);

    await Promise.all([...data.keys()].filter(code => !['CA', 'FA', '_RC'].includes(code)).map(async code => {

        // fill in the historical daily data per province
        const res = await get(`https://api.covid19tracker.ca/reports/province/${code}?after=2020-12-10&fill_dates=true`);
        if (res) {
            data.get(code).daily = res.data;
            // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
            if (res.last_updated) data.get(code).updated_at = new Date(res.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
        }

        // populate sub region data. hr_uid (generally) matches stats canada IDs, so we can marry the demographic data
        // first we need to map the regions to the province since the /hr/split data doesn't provide the association
        const regions = await get(`https://api.covid19tracker.ca/province/${code}/regions`);
        if (regions) {
            data.get(code).regions = regions;
            await Promise.all(regions.map(async r => {
                const regionDaily = await get(`https://api.covid19tracker.ca/regions/${r.hr_uid}/reports?after=2020-12-10&fill_dates=true`);
                if (regionDaily) {
                    r.daily = regionDaily.data.sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
                    // api is SK centric and does not emit ISO8601 formatted fields. Fortunately SK is always GMT-6
                    if (regionDaily.last_updated) r.updated_at =  new Date(regionDaily.last_updated.replace(/ (\d\d:\d\d:\d\d)$/, 'T$1-0600'));
                }
                if (hrData.has(r.hr_uid)) {
                    Object.assign(r, hrData.get(r.hr_uid));
                }
                if (r.id && r.hr_uid) r.id = r.hr_uid;
                delete r.hr_uid;
                if (!r.name && r.engname) r.name = r.engname;
                r.name = {en: r.name}
                if (r.frename) r.name.fr = r.frename;
                delete r.engname;
                delete r.frename;
            }))
        }
    }));

    const json = stringify(removeEmpty(Object.fromEntries(data.entries())), 2, 200);
    fs.writeFileSync('_data/covid19tracker.ca/data.json', json);
}

getData();
