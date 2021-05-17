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
      change_cases_per_1000k: item.change_cases >= 0 ? Math.round(item.change_cases / data.population * 1000*1000) : null,
      activePer100k: item.active_cases >= 0 ? Math.round(item.active_cases / data.population * 100*1000) : null,
      fatalitiesPer100k: item.total_fatalities >= 0 ? Math.round(item.total_fatalities / data.population * 100*1000) : null,
      hospitalizedPer1000k: item.total_hospitalizations >= 0 ? Math.round(item.total_hospitalizations / data.population * 1000*1000) : null,
      first_vaccination_per_person: Math.round((item.total_first_vaccination / data.population) * 1000) / 10,
      first_vaccination_per_2plus: Math.round((item.total_first_vaccination / data.population2plus) * 1000) / 10,
      first_vaccination_per_12plus: Math.round((item.total_first_vaccination / data.population12plus) * 1000) / 10,
      first_vaccination_per_18plus: Math.round((item.total_first_vaccination / data.population18plus) * 1000) / 10,
      vaccinated_per_person: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population) * 1000) / 10 : 0,
      vaccinated_per_2plus: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population2plus) * 1000) / 10 : 0,
      vaccinated_per_12plus: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population12plus) * 1000) / 10 : 0,
      vaccinated_per_18plus: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population18plus) * 1000) / 10 : 0,
      available_doses_per_person: item.available_doses > 0 ? Math.round((item.available_doses / data.population) * 1000) / 10 : 0,
      available_doses_per_2plus: item.available_doses > 0 ? Math.round((item.available_doses / data.population2plus) * 1000) / 10 : 0,
      available_doses_per_12plus: item.available_doses > 0 ? Math.round((item.available_doses / data.population12plus) * 1000) / 10 : 0,
      available_doses_per_18plus: item.available_doses > 0 ? Math.round((item.available_doses / data.population18plus) * 1000) / 10 : 0,
      total_cases_per_person: Math.round((item.total_cases / data.population) * 1000) / 10,
      total_fatalities_per_person: Math.round((item.total_fatalities / item.total_cases) * 1000) / 10,
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
    if (week.available_doses_sum > 0 ) {
      week.available_doses_days = week.available_doses_sum / week.change_vaccinations_sum + 0.5;
    }
    return week;
  });

  const [twoWeeksAgo] = previousWeeks.slice(-2);
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
    if (week.available_doses_sum > 0 ) {
      week.available_doses_days = week.available_doses_sum / week.change_vaccinations_sum + 0.5;
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

  // change in vaccinations relative to the previous  week
  let changeInVaccinationRate = 0;
  if (today.change_vaccinations > 0 && yesterday?.change_vaccinations > 0) {
    changeInVaccinationRate = Math.round((today.change_vaccinations - lastWeekExclusive.change_vaccinations_avg) / lastWeekExclusive.change_vaccinations_avg*100);
  }

  // change in cases relative to the previous week
  let changeInCasesRate = 0;
  if (today.change_cases > 0) {
    let changeCaseBase = yesterday.change_cases;
    if (data.complete || Math.abs(today.change_cases / yesterday.change_cases) > 0.75) {
      changeCaseBase = today.change_cases;
    }
    changeInCasesRate = Math.max(Math.min(Math.round((changeCaseBase - lastWeekExclusive.change_cases_avg) / (lastWeekExclusive.change_cases_avg+0.001)*100), 100), -100);
  }

  const calculateWeeks = function(population_dose, rateOfChangeExclusive = 0, rateOfChangeInclusive = 0, rateOfChangeTwoWeeksAgo = 0) {
    let daysToDose = 0;
    if (rateOfChangeExclusive > 0) {
      const optimisticChangeAvg = Math.max(rateOfChangeExclusive, rateOfChangeInclusive);
      const accelerationRate = (optimisticChangeAvg - rateOfChangeTwoWeeksAgo )/2;
      if (accelerationRate > 0 && rateOfChangeTwoWeeksAgo > 0) {
        // d = v1t + 1/2at^2
        // 0 = 1/2at^2 + v2t - d
        let a = (1/2) * accelerationRate;
        let b = optimisticChangeAvg;
        let c = -(population_dose);
        //(-b + ((b^2 -4ac)^(1/2)) / 2a
        daysToDose = Math.round((-b + Math.sqrt((b*b) - (4*a*c)))/(2*a));
        daysToDose = Math.max(Math.round(daysToDose + 0.5),0) * 7;
      }

      if (!daysToDose) {
        // if (!daysToFirstVaccinations) console.log(data.name, optimisticChangeAvg, twoWeeksAgo.change_first_vaccination_avg);
        daysToDose = Math.max(Math.round(population_dose / optimisticChangeAvg + 0.5),0) * 7;
      }
    }
    return new Date(Date.now() + (daysToDose *24*60*60*1000)).toJSON().split('T')[0];
  }
  const vaccinationPopulation = data.population12plus;
  const firstVaccinationsDate = calculateWeeks(vaccinationPopulation - today.total_first_vaccination, lastWeekExclusive.change_first_vaccination_sum, lastWeekInclusive.change_first_vaccination_sum, twoWeeksAgo.change_first_vaccination_sum);
  const daysToFirstVaccinations = Math.round((new Date(firstVaccinationsDate).getTime() - Date.now()) / 24/60/60/1000);

  // Most provinces have opted to focus on first dose, this skews the rate of full vaccination.
  // to account for this, we assume full vaccinations require 2 doses and use the current total doses rate
  let fullVaccinatedDate = calculateWeeks(vaccinationPopulation - today.total_vaccinated, lastWeekExclusive.change_vaccinated_sum, lastWeekInclusive.change_vaccinated_sum, twoWeeksAgo.change_vaccinated_sum);
  const fullVaccinatedByDosesDate = calculateWeeks((vaccinationPopulation*2) - today.total_vaccinations, lastWeekExclusive.change_vaccinations_sum, lastWeekInclusive.change_vaccinations_sum, twoWeeksAgo.change_vaccinations_sum);
  // if (new Date(fullVaccinatedDate).getTime() > new Date(fullVaccinatedByDosesDate).getTime()) {
    fullVaccinatedDate = fullVaccinatedByDosesDate;
  // }

  //convenience checks for maximums
  const [maxVaccinations, maxChangeCases, maxActiveCases, maxAvailableDoses] = ["change_vaccinations", "change_cases", "active_cases", "available_doses"].map(name => {
    return Math.max(...previousWeeks.slice(-8).map(weekData => weekData[name + "_avg"] || 0), ...previous7Days.map(dayData => dayData[name]).map(v => v || 0), today[name] || 0, 0);
  })

  today.sort_change_cases_per_1000k = today.change_cases_per_1000k || lastWeekExclusive.change_cases_per_1000k_avg;

  return {
    previousWeeks,
    lastWeekExclusive,
    lastWeekInclusive,
    previous7Days,
    yesterday,
    today,
    vaccine: {
      changeInVaccinationRate,
      daysToFirstVaccinations,
      firstVaccinationsDate,
      fullVaccinatedDate,
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
      prov.population2plus = prov.population * (100-(prov["0-1"] || 0)) / 100;
      prov.population12plus = prov.population * (100-(prov["0-1"] || 0)-(prov["2-11"] || 0)) / 100;
      prov.population18plus = prov.population * (100-(prov["0-1"] || 0)-(prov["2-11"] || 0)-(prov["12-17"] || 0)) / 100;
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
      if (region.population > 0) {
        region.population15plus = region.population * (100-(prov["0-14"] || 0)) / 100;
        region.population2plus = region.population * (100-(prov["0-1"] || 0)) / 100;
        region.population12plus = region.population * (100-(prov["0-1"] || 0)-(prov["2-11"] || 0)) / 100;
        region.population18plus = region.population * (100-(prov["0-1"] || 0)-(prov["2-11"] || 0)-(prov["12-17"] || 0)) / 100;
      }
      Object.assign(region, normalizeVaccine(region));
    }
    prov.regions = prov.regions?.sort((a,b) => b.population - a.population);
    if (/Reported/.test(prov.data_status) && prov.total.date !== new Date(Date.now() - 7*60*60*1000).toJSON().split('T')[0]) {
      prov.data_status = "Waiting For Report";
    }
  }

  return data.sort((a,b) => b.population - a.population);
};
