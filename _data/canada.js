const Cache = require("@11ty/eleventy-cache-assets");

function chunkArray(myArray, chunkSize){
  const results = [];

  while (myArray.length) {
    results.unshift(myArray.splice(-chunkSize));
  }

  return results;
}

function normalizeVaccine(data) {
  data.daily = data?.daily?.sort((a,b) => a?.date.localeCompare(b?.date));
  const changeVaccinations = data.total.change_vaccinations;
  const totalVaccinations = data.total.total_vaccinations || 0;
  const totalVaccinated = data.total.total_vaccinated || 0;
  const totalCases = data.total.total_cases;
  const totalFatalities = data.total.total_fatalities;
  const population = data.population;
  const totalRecoveries = data.total.total_recoveries || 0;
  const currentChangeCases = data.total.change_cases;
  const activeCases = totalCases - totalFatalities - totalRecoveries;
  const currentHospitalized = data.total.total_hospitalizations;

  const vaccinationsPerCapita = Math.round(((totalVaccinations - (totalVaccinated || 0))/ data.population) * 1000) / 10;
  const casesPerCapita = Math.round((totalCases / data.population) * 1000) / 10;
  const deathsPerCase = Math.round((totalFatalities / totalCases) * 1000) / 10;
  const activePer100k = activeCases > 0 ? Math.round(activeCases / population * 100*1000) : 0;
  const hospitalizedPer1000k = currentHospitalized >= 0 ? Math.round(currentHospitalized / population * 1000*1000) : null;
  const vaccinationsCompletePerCapita = totalVaccinated > 0 ? Math.round((totalVaccinated / data.population) * 1000) / 10 : null;

  const itemVaccinesAvailable = data.total.total_vaccines_distributed - (totalVaccinations || 0);

  const weekly = chunkArray(data.daily.slice(0, -1), 7).map(item => ({
    start: item[0].date,
    end: item[item.length-1].date,
    vaccinationsAvg: Math.round(item.map(i => i.change_vaccinations).reduce((p, c) => p + c) / item.length + 0.5),
    newCasesAvg: Math.round(item.map(i => i.change_cases).reduce((p, c) => p + c) / item.length + 0.5),
    activeAvg: Math.round(item.map(v => (v.total_cases || 0) - (v.total_fatalities || 0) - (v.total_recoveries || 0)).reduce((p, c) => p + c) / item.length + 0.5)
  }));
  const lastWeek = data.daily.slice(-8, -1).map(item =>({
    date: item.date,
    change_vaccinations: item.change_vaccinations || 0,
    change_cases: item.change_cases,
    active_cases: (item.total_cases || 0) - (item.total_fatalities || 0) - (item.total_recoveries || 0)
  }));
  const yesterday = lastWeek.slice(-1)[0];

  const last7DayTests = data.daily.slice(-7).map(i => i.change_tests).reduce((p, c) => p + c);
  const last7DayCases = data.daily.slice(-7).map(i => i.change_cases).reduce((p, c) => p + c);
  const weekPositiviityRate = last7DayTests > 0 ? Math.round(last7DayCases / last7DayTests * 1000) / 10 : null;


  const weekVaccinations = lastWeek.map(v => v.change_vaccinations || 0);
  const weekVaccinationsAvg = Math.floor(weekVaccinations.reduce((c, v) => c + v) / lastWeek.length);
  const weekActive = lastWeek.map(v => v.active_cases);
  const weekActiveAvg = Math.floor(weekActive.reduce((c, v) => c + v) / lastWeek.length);
  const weekNewCases = lastWeek.map(v => v.change_cases);

  const yesterdayVaccinations = yesterday?.change_vaccinations;
  const changeInVaccinationRate = changeVaccinations > 0 && yesterdayVaccinations > 0 ? Math.round((changeVaccinations - weekVaccinationsAvg) / weekVaccinationsAvg*100) : 0;
  const daysToFullVaccinations = weekVaccinationsAvg > 0 ? Math.max(Math.round((data.population - (totalVaccinations - totalVaccinated || 0)) / weekVaccinationsAvg / 7 + 0.5),0) : 0;
  const daysToZeroVaccines = itemVaccinesAvailable > 0 ? Math.max(Math.round(itemVaccinesAvailable / (weekVaccinationsAvg-0.001) + 0.5),0) : null;


  const wowActiveCases = Math.max(Math.min(Math.round((activeCases - weekActiveAvg) / (weekActiveAvg+0.001)*100), 100), -100);

  const maxVaccinations = Math.max(...weekly.map(w => w.vaccinationsAvg || 0), ...weekVaccinations.map(v => v || 0), changeVaccinations || 0, 0);
  const maxChangeCases = Math.max(...weekly.slice(-8).map(w => w.newCasesAvg || 0), ...weekNewCases.map(v => v || 0), currentChangeCases || 0, 0);
  const maxActiveCases = Math.max(...weekly.slice(-8).map(w => w.activeAvg || 0), ...weekActive.map(v => v || 0), activeCases || 0, 0);
 return {
   data_status: data.data_status,
   lastWeek,
   yesterday,
   weekly,
   vaccine: {
     totalVaccinations,
     totalVaccinated,
     vaccinationsPerCapita,
     vaccinationsCompletePerCapita,
     itemVaccinesAvailable,
     weekVaccinations,
     weekVaccinationsAvg,
     yesterdayVaccinations,
     changeInVaccinationRate,
     daysToFullVaccinations,
     daysToZeroVaccines,
     maxVaccinations
   },
   infection: {
     activeCases,
     weekPositiviityRate,
     casesPerCapita,
     deathsPerCase,
     activePer100k,
     hospitalizedPer1000k,
     wowActiveCases,
     maxChangeCases,
     maxActiveCases,
   }
 }
}
module.exports = async function() {
  const fullData  = await Cache("https://colinbendell.github.io/covid19data.ca/data.json", {
    duration: "30m", // 1 day
    type: "json" // also supports "text" or "buffer"
  });

  const data = Object.keys(fullData).map(k => Object.assign(fullData[k], {code: k}));
  for (const prov of data) {
    if (prov.data_status && !/in progress|reported|no report/i.test(prov.data_status)) {
      prov.daily.pop();
      prov.total = prov.daily[prov.daily.length - 1];
    }

    Object.assign(prov, normalizeVaccine(prov))

    prov.regions = prov.regions?.filter(r => Number.isInteger(r.total?.total_vaccinations) && r.daily) || [];
    for (const region of prov.regions) {
      if (prov.data_status && !/in progress|reported|no report/i.test(prov.data_status)) {
      // if (!region.total?.change_cases) {
        region.daily.pop();
        region.total = region.daily[region.daily.length - 1];
      }

      Object.assign(region, normalizeVaccine(region));
    }
  }

  return data.sort((a,b) => b.population - a.population);
};
