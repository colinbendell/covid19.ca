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
      active_cases: item.active_cases || ((item.total_cases || 0) - (item.total_fatalities || 0) - (item.total_recoveries || 0)),
    }))
    .map(item =>Object.assign(item, {
      activePer100k: item.active_cases >= 0 ? Math.round(item.active_cases / data.population * 100*1000) : null,
      fatalitiesPer100k: item.total_fatalities >= 0 ? Math.round(item.total_fatalities / data.population * 100*1000) : null,
      hospitalizedPer1000k: item.total_hospitalizations >= 0 ? Math.round(item.total_hospitalizations / data.population * 1000*1000) : null,
      vaccinationsHalfPerCapita: Math.round((item.total_first_vaccination / data.population15plus) * 1000) / 10,
      vaccinationsCompletePerCapita: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population15plus) * 1000) / 10 : 0,
      casesPerCapita: Math.round((item.total_cases / data.population) * 1000) / 10,
      deathsPerCase: Math.round((item.total_fatalities / item.total_cases) * 1000) / 10,
      positivityRate: item.change_tests > 0 ? Math.round(item.change_cases / item.change_tests * 1000) / 10 : null,
    }));

  const [today] = data.daily.slice(-1);

  if (today) {
    //calculate the rate ot change between days
    const keys = Object.keys(today).filter(k => Number.isFinite(today[k]));
    for (const i of Array(data.daily.length).keys()) {
      if (i > 0) {
        const last = data.daily[i - 1];
        const curr = data.daily[i];
        for (const key of keys) {
          curr["change_" + key] = (curr[key] || 0) - (last[key] || 0);
        }
      }
    }
  }

  const previousWeeks = chunkArray(data.daily.slice(0, -1), 7).map(item => {
    const [last] = item.slice(-1);
    const week = {
      start: item[0].date,
      end: last.date,
    };
    const keys = new Set(item.map(i => Object.keys(i)).flat());
    for (const key of keys) {
      // only numeric values; assume that periodic entries are numeric. worst case they will add to zero or NaN
      if (Number.isFinite(last[key]) || !last[key] ) {
        week[key + "_avg"] = Math.round(item.map(i => i[key] || 0).reduce((p, c) => p + c) / item.length * 10)/10;
        week[key + "_sum"] = item.map(i => i[key] || 0).reduce((p, c) => p + c);
      }
    }
    if (week.change_tests_sum > 0) {
      week.positivity_rate = Math.round(week.change_cases_sum / week.change_tests_sum * 1000) / 10;
    }
    return week;
  });

  const [lastWeekExclusive] = previousWeeks.slice(-1);

  const [lastWeekInclusive] = [data.daily.slice(-7)].map(item => {
    const [last] = item.slice(-1);
    const week = {
      start: item[0].date,
      end: last.date,
    };
    const keys = new Set(item.map(i => Object.keys(i)).flat());
    for (const key of keys) {
      // only numeric values; assume that periodic entries are numeric. worst case they will add to zero or NaN
      if (Number.isFinite(last[key]) || !last[key] ) {
        week[key + "_avg"] = Math.round(item.map(i => i[key] || 0).reduce((p, c) => p + c) / item.length * 10) / 10;
        week[key + "_sum"] = item.map(i => i[key] || 0).reduce((p, c) => p + c);
      }
    }
    if (week.change_tests_sum > 0) {
      week.positivity_rate = Math.round(week.change_cases_sum / week.change_tests_sum * 1000) / 10;
    }
    return week;
  });

  if (lastWeekExclusive) {
    //calculate the rate ot change between weeks
    const keys = Object.keys(lastWeekExclusive).filter(k => Number.isFinite(lastWeekExclusive[k]));
    for (const i of Array(previousWeeks.length).keys()) {
      if (i > 0) {
        const last = previousWeeks[i -1];
        const curr = previousWeeks[i];
        for (const key of keys) {
          curr["change_" + key] = (curr[key] || 0) - (last[key] || 0);

          //special case where we want to also apply the change_ calculation to lastWeekInclusive as well
          if (curr === lastWeekExclusive) {
            lastWeekInclusive["change_" + key] = (lastWeekInclusive[key] || 0) - (last[key] || 0);
          }
        }
      }
    }
  }


  const previous7Days = data.daily.slice(-8, -1);
  const [yesterday] = previous7Days.slice(-1);

  const changeInVaccinationRate = today.change_vaccinations > 0 && yesterday?.change_vaccinations > 0 ? Math.round((today.change_vaccinations - lastWeekExclusive.change_vaccinations_avg) / lastWeekExclusive.change_vaccinations_avg*100) : 0;
  const daysToFirstVaccinations = lastWeekExclusive.change_first_vaccination_avg > 0 ? Math.max(Math.round((data.population15plus - today.total_first_vaccination) / Math.max(lastWeekExclusive.change_first_vaccination_avg, lastWeekInclusive.change_first_vaccination_avg) / 7 + 0.5),0) : 0;

  // Most provinces have opted to focus on first dose, this skews the rate of full vaccination.
  // to account for this, we assume full vaccinations require 2 doses and use the current total doses rate
  const changeInFullVaccinatedRate = lastWeekInclusive.change_vaccinated_avg > 0 && yesterday?.change_vaccinated > 0 ? Math.round((today.change_vaccinated - lastWeekExclusive.change_vaccinated_avg) / lastWeekExclusive.change_vaccinated_avg*100) : 0;
  const daysToFullVaccinatedCurrentRate = lastWeekExclusive.change_vaccinated_avg > 0 ? Math.max(Math.round((data.population15plus - today.total_vaccinated) / Math.max(lastWeekExclusive.change_vaccinated_avg, lastWeekInclusive.change_vaccinated_avg) / 7 + 0.5),0) : 0;
  const daysToFullVaccinatedAssume2Dose = lastWeekExclusive.change_vaccinations_avg > 0 ? Math.max(Math.round(((data.population15plus*2) - today.total_first_vaccination - today.total_vaccinated) / Math.max(lastWeekExclusive.change_vaccinations_avg, lastWeekInclusive.change_vaccinations_avg) / 7 + 0.5),0) : 0;
  const daysToFullVaccinated = Math.min(daysToFullVaccinatedCurrentRate, daysToFullVaccinatedAssume2Dose);

  const completeDate = new Date(Date.now() + (Math.min(daysToFullVaccinated, daysToFirstVaccinations) * 7*24*60*60*1000)).toJSON().split('T')[0];
  const fullVaccinatedDate = new Date(Date.now() + (daysToFullVaccinated * 7*24*60*60*1000)).toJSON().split('T')[0];
  const firstVaccinationsDate = new Date(Date.now() + (daysToFirstVaccinations * 7*24*60*60*1000)).toJSON().split('T')[0];
  const daysToZeroVaccines = today.available_doses > 0 ? Math.max(Math.round(today.available_doses / (lastWeekInclusive.change_vaccinations_avg-0.001) + 0.5),0) : null;

  const changeCaseBase = data.complete || Math.abs(today.change_cases / yesterday.change_cases) > 0.75  ? today.change_cases : yesterday.change_cases;
  const changeInCasesRate = today.change_cases > 0 ? Math.max(Math.min(Math.round((changeCaseBase - lastWeekExclusive.change_cases_avg) / (lastWeekExclusive.change_cases_avg+0.001)*100), 100), -100) : 0;

  const maxVaccinations = Math.max(...previousWeeks.slice(-8).map(w => w.change_vaccinations_avg || 0), ...previous7Days.map(v => v.change_vaccinations).map(v => v || 0), today.change_vaccinations || 0, 0);
  const maxChangeCases = Math.max(...previousWeeks.slice(-8).map(w => w.change_cases_avg || 0), ...previous7Days.map(v => v.change_cases).map(v => v || 0), today.change_cases || 0, 0);
  const maxActiveCases = Math.max(...previousWeeks.slice(-8).map(w => w.active_cases_avg || 0), ...previous7Days.map(v => v.active_cases).map(v => v || 0), today.active_cases || 0, 0);
  const maxAvailableDoses = Math.max(...previousWeeks.slice(-8).map(w => w.available_doses_avg || 0), ...previous7Days.map(v => v.available_doses).map(v => v || 0), today.available_doses || 0, 0);
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
     fullVaccinatedDate,
     firstVaccinationsDate,
     maxVaccinations,
     maxAvailableDoses,
   },
   infection: {
     changeInCasesRate,
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
  fullData['CA'].data_status = [...Object.keys(fullData)]
                                .filter(k => k !== 'CA')
                                .map(k => fullData[k].data_status)
                                .filter(s => !/reported|no report/i.test(s))
                                .reduce((p, c) => /In Progress/i.test(p + c) ? "In Progress" : "Waiting For Report", null) || "Reported";
  const data = Object.keys(fullData).map(k => Object.assign(fullData[k], {code: k, iso3166: k === 'PE' ? 'PEI' : k === 'NT' ? 'NWT' : k }));
  for (const prov of data) {
    prov.complete = /reported/i.test(prov.data_status);
    const [provTotal] = prov.daily.slice(-1);
    if (!prov.data_status || !/reported|progress/i.test(prov.data_status)) {
      if (provTotal?.date === new Date().toJSON().split('T')[0]) {
        if (!provTotal?.change_cases) {
          prov.daily.pop();
        }
      }
    }

    prov.total = prov.daily[prov.daily.length - 1];
    if (prov.population > 0) {
      prov.population15plus = prov.population * (100-(prov["0-14"] || 0)) / 100;
      prov.population12plus = prov.population * (100-(prov["0-11"] || 0)) / 100;
      prov.population18plus = prov.population * (100-(prov["0-11"] || 0)-(prov["12-17"] || 0)) / 100;
    }
    Object.assign(prov, normalizeVaccine(prov))

    // only real health regions
    prov.regions = prov.regions?.filter(r => r.daily && !['NT', 'NU', 'PE', 'YT'].includes(r.province)) || [];

    // that have total values
    prov.regions = prov.regions?.filter(r => Number.isInteger(r.daily[r.daily.length - 1]?.total_vaccinations) ||  Number.isInteger(r.daily[r.daily.length - 1]?.total_cases)) || [];

    for (const region of prov.regions) {
      region.complete = prov.complete;
      region.data_status = prov.data_status;
      const [regionTotal] = region.daily.slice(-1);
      if (prov.data_status && !/reported|progress/i.test(prov.data_status)) {
        if (regionTotal?.date === new Date().toJSON().split('T')[0]) {
          if (!regionTotal?.change_cases) {
            region.daily.pop();
          }
        }
      // if (!region.total?.change_cases) {
      }
      region.total = region.daily[region.daily.length - 1];
      if (region.population > 0) region.population15plus = region.population * (100-(prov["0-14"] || 0)) / 100;
      Object.assign(region, normalizeVaccine(region));
    }
    prov.regions = prov.regions?.sort((a,b) => b.population - a.population);
    if (/Reported/.test(prov.data_status) && prov.total.date !== new Date(Date.now() - 7*60*60*1000).toJSON().split('T')[0]) {
      prov.data_status = "Waiting For Report";
    }
  }

  return data.sort((a,b) => b.population - a.population);
};
