const fs = require('fs');
// const Cache = require("@11ty/eleventy-cache-assets");

function chunkArray(myArray, chunkSize){
  const results = [];

  while (myArray.length) {
    results.unshift(myArray.splice(-chunkSize));
  }

  return results;
}

function normalizeVaccine(data) {
  data.daily = data?.daily?.sort((a,b) => a?.date.localeCompare(b?.date))
    .map(item =>Object.assign(item, {
      change_vaccinations: item.change_vaccinations || 0,
      change_vaccinated: item.change_vaccinated || 0,
      change_first_vaccination: (item.change_vaccinations || 0) - (item.change_vaccinated || 0),
      total_vaccinations: item.total_vaccinations || 0,
      total_vaccinated: item.total_vaccinated || 0,
      total_first_vaccination: (item.total_vaccinations || 0) - (item.total_vaccinated || 0),
      available_doses: item.total_vaccines_distributed > 0 ? (item.total_vaccines_distributed || 0) - (item.total_vaccinations || 0) : null,
      active_cases: (item.total_cases || 0) - (item.total_fatalities || 0) - (item.total_recoveries || 0),
    }))
    .map(item =>Object.assign(item, {
      activePer100k: item.active_cases >= 0 ? Math.round(item.active_cases / data.population * 100*1000) : null,
      fatalitiesPer100k: item.total_fatalities >= 0 ? Math.round(item.total_fatalities / data.population * 100*1000) : null,
      hospitalizedPer1000k: item.total_hospitalizations >= 0 ? Math.round(item.total_hospitalizations / data.population * 1000*1000) : null,
      vaccinationsPerCapita: Math.round(((item.total_vaccinations - (item.total_vaccinated || 0))/ data.population) * 1000) / 10,
      vaccinationsCompletePerCapita: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population) * 1000) / 10 : 0,
      casesPerCapita: Math.round((item.total_cases / data.population) * 1000) / 10,
      deathsPerCase: Math.round((item.total_fatalities / item.total_cases) * 1000) / 10,
      positivityRate: item.change_tests > 0 ? Math.round(item.change_cases / item.change_tests * 1000) / 10 : null,
    }));

  const [today] = data.daily.slice(-1);

  const keys = Object.keys(today).filter(k => Number.isFinite(today[k]));
  for (const i of Array(data.daily.length).keys()) {
    if (i > 0) {
      const last = data.daily[i -1];
      const curr = data.daily[i];
      for (const key of keys) {
        curr["change_" + key] = (curr[key] || 0) - (last[key] || 0);
      }
    }
  }

  const previousWeeks = chunkArray(data.daily.slice(0, -1), 7).map(item => {
    const [last] = item.slice(-1);
    const avg = {
      start: item[0].date,
      end: last.date,
      sumChangeTests: item.map(i => i.change_tests || 0).reduce((p, c) => p + c),
      sumChangeCases: item.map(i => i.change_cases || 0).reduce((p, c) => p + c),
    };
    for (const key of Object.keys(last)) {
      if (Number.isFinite(last[key])) {
        avg[key + "_avg"] = Math.round(item.map(i => i[key] || 0).reduce((p, c) => p + c) / item.length + 0.5);
        avg[key + "_sum"] = item.map(i => i[key] || 0).reduce((p, c) => p + c);
      }
    }
    return avg;
  }).map(item => Object.assign(item, {
    weekPositivityRate: item.sumChangeTests > 0 ? Math.round(item.sumChangeCases / item.sumChangeTests * 1000) / 10 : null,
  }));

  const [lastWeekExclusive] = previousWeeks.slice(-1);

  keys.splice(0, keys.length);
  keys.concat(...Object.keys(lastWeekExclusive).filter(k => Number.isFinite(lastWeekExclusive[k])));
  for (const i of Array(previousWeeks.length).keys()) {
    if (i > 0) {
      const last = previousWeeks[i -1];
      const curr = previousWeeks[i];
      for (const key of keys) {
        curr["change_" + key] = (curr[key] || 0) - (last[key] || 0);
      }
    }
  }

  const [lastWeekInclusive] = [data.daily.slice(-7)].map(item => {
    const [last] = item.slice(-1);
    const avg = {
      start: item[0].date,
      end: last.date,
      sumChangeTests: item.map(i => i.change_tests || 0).reduce((p, c) => p + c),
      sumChangeCases: item.map(i => i.change_cases || 0).reduce((p, c) => p + c),
    };
    for (const key of Object.keys(last)) {
      if (Number.isFinite(last[key])) {
        avg[key + "_avg"] = Math.round(item.map(i => i[key] || 0).reduce((p, c) => p + c) / item.length + 0.5);
        avg[key + "_sum"] = item.map(i => i[key] || 0).reduce((p, c) => p + c);
      }
    }
    return avg;
  }).map(item => Object.assign(item, {
    weekPositivityRate: item.sumChangeTests > 0 ? Math.round(item.sumChangeCases / item.sumChangeTests * 1000) / 10 : null,
  }));

  const previous7Days = data.daily.slice(-8, -1);
  const [yesterday] = previous7Days.slice(-1);

  const changeInVaccinationRate = today.change_vaccinations > 0 && yesterday?.change_vaccinations > 0 ? Math.round((today.change_vaccinations - lastWeekExclusive.change_vaccinations_avg) / lastWeekExclusive.change_vaccinations_avg*100) : 0;
  const daysToFirstVaccinations = lastWeekExclusive.change_first_vaccination_avg > 0 ? Math.max(Math.round((data.population - today.total_first_vaccination) / Math.max(lastWeekExclusive.change_first_vaccination_avg, lastWeekInclusive.change_first_vaccination_avg) / 7 + 0.5),0) : 0;

  // Most provinces have opted to focus on first dose, this skews the rate of full vaccination.
  // to account for this, we assume full vaccinations require 2 doses and use the current total doses rate
  const changeInFullVaccinatedRate = lastWeekInclusive.change_vaccinated_avg > 0 && yesterday?.change_vaccinated > 0 ? Math.round((today.change_vaccinated - lastWeekExclusive.change_vaccinated_avg) / lastWeekExclusive.change_vaccinated_avg*100) : 0;
  const daysToFullVaccinatedCurrentRate = lastWeekExclusive.change_vaccinated_avg > 0 ? Math.max(Math.round((data.population - today.total_vaccinated) / Math.max(lastWeekExclusive.change_vaccinated_avg, lastWeekInclusive.change_vaccinated_avg) / 7 + 0.5),0) : 0;
  const daysToFullVaccinatedAssume2Dose = lastWeekExclusive.change_vaccinations_avg > 0 ? Math.max(Math.round(((data.population*2) - today.total_first_vaccination - today.total_vaccinated) / Math.max(lastWeekExclusive.change_vaccinations_avg, lastWeekInclusive.change_vaccinations_avg) / 7 + 0.5),0) : 0;
  const daysToFullVaccinated = Math.min(daysToFullVaccinatedCurrentRate, daysToFullVaccinatedAssume2Dose);

  const completeDate = new Date(Date.now() + (Math.min(daysToFullVaccinated, daysToFirstVaccinations) * 7*24*60*60*1000)).toJSON().split('T')[0];
  const daysToZeroVaccines = today.available_doses > 0 ? Math.max(Math.round(today.available_doses / (lastWeekInclusive.change_vaccinations_avg-0.001) + 0.5),0) : null;

  const wowActiveCases = Math.max(Math.min(Math.round((today.active_cases - lastWeekExclusive.active_cases_avg) / (lastWeekExclusive.active_cases_avg+0.001)*100), 100), -100);

  const maxVaccinations = Math.max(...previousWeeks.slice(-8).map(w => w.change_vaccinations_avg || 0), ...previous7Days.map(v => v.change_vaccinations).map(v => v || 0), today.change_vaccinations || 0, 0);
  const maxChangeCases = Math.max(...previousWeeks.slice(-8).map(w => w.change_cases_avg || 0), ...previous7Days.map(v => v.change_cases).map(v => v || 0), data.total.change_cases || 0, 0);
  const maxActiveCases = Math.max(...previousWeeks.slice(-8).map(w => w.active_cases_avg || 0), ...previous7Days.map(v => v.active_cases).map(v => v || 0), data.total.active_cases || 0, 0);
 return {
   previousWeeks,
   lastWeekExclusive,
   lastWeekInclusive,
   previous7Days,
   yesterday,
   today,
   vaccine: {
     changeInVaccinationRate,
     changeInFullVaccinatedRate,
     daysToZeroVaccines,
     daysToFirstVaccinations,
     daysToFullVaccinated,
     completeDate,
     maxVaccinations
   },
   infection: {
     wowActiveCases,
     maxChangeCases,
     maxActiveCases,
   }
 }
}
module.exports = async function() {
  // const fullData  = await Cache("https://colinbendell.github.io/covid19data.ca/data.json", {
  //   duration: "30m", // 1 day
  //   type: "json" // also supports "text" or "buffer"
  // });
  const fullData = JSON.parse(fs.readFileSync('_data/covid19tracker.ca/data.json', 'utf-8'));
  const data = Object.keys(fullData).map(k => Object.assign(fullData[k], {code: k}));
  for (const prov of data) {
    if (prov.data_status && !/reported/i.test(prov.data_status)) {
      if (prov.total?.date === new Date().toJSON().split('T')[0]) {
        if (!prov.total?.change_cases) {
          prov.daily.pop();
        }
      }
    }

    prov.total = prov.daily[prov.daily.length - 1];
    Object.assign(prov, normalizeVaccine(prov))

    // only real health regions
    prov.regions = prov.regions?.filter(r => r.daily && !['NT', 'NU', 'PE', 'YT'].includes(r.province)) || [];

    // that have total values
    prov.regions = prov.regions?.filter(r => Number.isInteger(r.total?.total_vaccinations) ||  Number.isInteger(r.total?.total_cases)) || [];

    for (const region of prov.regions) {
      if (prov.data_status && !/reported/i.test(prov.data_status)) {
        if (region.total?.date === new Date().toJSON().split('T')[0]) {
          if (!region.total?.change_cases) {
            region.daily.pop();
          }
        }
      // if (!region.total?.change_cases) {
      }
      region.total = region.daily[region.daily.length - 1];

      Object.assign(region, normalizeVaccine(region));
    }
  }

  return data.sort((a,b) => b.population - a.population);
};
