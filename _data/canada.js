const fs = require('fs');
const PolynomialRegression = require('ml-regression-polynomial');

function chunkArray(myArray, chunkSize){
  const results = [];

  while (myArray.length) {
    results.unshift(myArray.splice(-chunkSize));
  }

  return results;
}

function normalizeDayData(data, item) {
  item = Object.assign(item, {
    change_vaccinations: item.change_vaccinations || 0,
    change_vaccinated: item.change_vaccinated || 0,
    change_first_vaccination: (item.change_vaccinations || 0) - (item.change_vaccinated || 0),
    total_vaccinations: item.total_vaccinations || 0,
    total_vaccinated: item.total_vaccinated || 0,
    total_first_vaccination: (item.total_vaccinations || 0) - (item.total_vaccinated || 0),
    available_doses: item.total_vaccines_distributed > 0 ? (item.total_vaccines_distributed || 0) - (item.total_vaccinations || 0) : null,
    active_cases: item.active_cases || ((item.total_cases || 0) - (item.total_fatalities || 0) - (item.total_recoveries || 0)),
  });
  item = Object.assign(item, {
    change_vaccinations_per_1k: item.change_vaccinations >= 0 ? Math.round(item.change_vaccinations / data.population * 10*1000)/10 : null,
    change_cases_per_1000k: item.change_cases >= 0 ? Math.round(item.change_cases / data.population * 1000*1000) : null,
    activePer100k: item.active_cases >= 0 ? Math.round(item.active_cases / data.population * 100*1000) : null,
    fatalitiesPer100k: item.total_fatalities >= 0 ? Math.round(item.total_fatalities / data.population * 100*1000) : null,
    hospitalizedPer1000k: item.total_hospitalizations >= 0 ? Math.round(item.total_hospitalizations / data.population * 1000*1000) : null,
    first_vaccination_per_person: Math.round((item.total_first_vaccination / data.population) * 1000) / 10,
    first_vaccination_per_2plus: Math.round((item.total_first_vaccination / data.population2plus) * 1000) / 10,
    first_vaccination_per_12plus: Math.round((item.total_first_vaccination / data.population12plus) * 1000) / 10,
    first_vaccination_per_18plus: Math.round((item.total_first_vaccination / data.population18plus) * 1000) / 10,
    first_vaccination_per_40plus: Math.round((item.total_first_vaccination / data.population40plus) * 1000) / 10,
    vaccinated_per_person: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population) * 1000) / 10 : 0,
    vaccinated_per_2plus: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population2plus) * 1000) / 10 : 0,
    vaccinated_per_12plus: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population12plus) * 1000) / 10 : 0,
    vaccinated_per_18plus: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population18plus) * 1000) / 10 : 0,
    vaccinated_per_40plus: item.total_vaccinated > 0 ? Math.round((item.total_vaccinated / data.population40plus) * 1000) / 10 : 0,
    available_doses_per_person: item.available_doses > 0 ? Math.round((item.available_doses / data.population) * 1000) / 10 : 0,
    available_doses_per_2plus: item.available_doses > 0 ? Math.round((item.available_doses / data.population2plus) * 1000) / 10 : 0,
    available_doses_per_12plus: item.available_doses > 0 ? Math.round((item.available_doses / data.population12plus) * 1000) / 10 : 0,
    available_doses_per_18plus: item.available_doses > 0 ? Math.round((item.available_doses / data.population18plus) * 1000) / 10 : 0,
    available_doses_per_40plus: item.available_doses > 0 ? Math.round((item.available_doses / data.population40plus) * 1000) / 10 : 0,
    total_cases_per_person: Math.round((item.total_cases / data.population) * 1000) / 10,
    total_fatalities_per_person: Math.round((item.total_fatalities / item.total_cases) * 1000) / 10,
    positivityRate: item.change_tests > 0 ? Math.round(item.change_cases / item.change_tests * 1000) / 10 : null,
  });

  return item;
}

function normalizeDays(items = [], altLast) {
  //calculate the rate ot change between days
  const [lastItem] = items.slice(-1);
  if (lastItem) {
    const keys = Object.keys(lastItem).filter(k => Number.isFinite(lastItem[k]));
    for (const i of Array(items.length).keys()) {
      if (i > 0) {
        const last = items[i - 1];
        const curr = items[i];
        for (const key of keys) {
          curr["change_" + key] = (curr[key] || 0) - (last[key] || 0);

          //special case where we want to also apply the change_ calculation to lastWeekInclusive as well
          if (altLast && curr === lastItem) {
            altLast["change_" + key] = (altLast[key] || 0) - (last[key] || 0);
          }
        }
      }
    }
  }
  return items;
}

function normalizeWeekData(data, item) {
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
}
function normalizeVaccine(data) {
  data.daily = data?.daily?.sort((a,b) => a?.date.localeCompare(b?.date)).map(item => normalizeDayData(data, item));
  const [today] = data.daily.slice(-1);
  normalizeDays(data.daily);

  const previousWeeks = chunkArray(data.daily.slice(0, -1), 7).map(item => normalizeWeekData(data, item));
  const [twoWeeksAgo] = previousWeeks.slice(-2);
  const [lastWeekExclusive] = previousWeeks.slice(-1);
  const [lastWeekInclusive] = [data.daily.slice(-7)].map(item => normalizeWeekData(data, item));
  normalizeDays(previousWeeks, lastWeekInclusive);

  const previous7Days = data.daily.slice(-8, -1);
  const [yesterday] = previous7Days.slice(-1);

  // change in vaccinations relative to the previous  week
  today.change_vaccinations_rate = 0;
  if (today.change_vaccinations > 0 && yesterday?.change_vaccinations > 0) {
    today.change_vaccinations_rate = Math.round((today.change_vaccinations - lastWeekExclusive.change_vaccinations_avg) / lastWeekExclusive.change_vaccinations_avg*100);
  }

  // change in cases relative to the previous week
  today.change_cases_rate = 0;
  if (today.change_cases > 0) {
    let changeCaseBase = yesterday.change_cases;
    if (data.complete || Math.abs(today.change_cases / yesterday.change_cases) > 0.75) {
      changeCaseBase = today.change_cases;
    }
    today.change_cases_rate = Math.max(Math.min(Math.round((changeCaseBase - lastWeekExclusive.change_cases_avg) / (lastWeekExclusive.change_cases_avg+0.001)*100), 100), -100);
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
  today.complete_first_vaccination_date = calculateWeeks(vaccinationPopulation - today.total_first_vaccination, lastWeekExclusive.change_first_vaccination_sum, lastWeekInclusive.change_first_vaccination_sum, twoWeeksAgo.change_first_vaccination_sum);
  today.days_to_complete_first_vaccination = Math.round((new Date(today.complete_first_vaccination_date).getTime() - Date.now()) / 24/60/60/1000);

  // Most provinces have opted to focus on first dose, this skews the rate of full vaccination.
  // to account for this, we assume full vaccinations require 2 doses and use the current total doses rate
  today.complete_vaccinated_date = calculateWeeks(vaccinationPopulation - today.total_vaccinated, lastWeekExclusive.change_vaccinated_sum, lastWeekInclusive.change_vaccinated_sum, twoWeeksAgo.change_vaccinated_sum);
  const fullVaccinatedByDosesDate = calculateWeeks((vaccinationPopulation*2) - today.total_vaccinations, lastWeekExclusive.change_vaccinations_sum, lastWeekInclusive.change_vaccinations_sum, twoWeeksAgo.change_vaccinations_sum);
  // if (new Date(today.complete_vaccinated_date).getTime() > new Date(fullVaccinatedByDosesDate).getTime()) {
  today.complete_vaccinated_date = fullVaccinatedByDosesDate;
  // }

  //convenience checks for maximums
  for (const name of ["change_vaccinations", "change_cases", "active_cases", "available_doses"]) {
    today[name + "_max"] = Math.max(...previousWeeks.slice(-8).map(weekData => weekData[name + "_avg"] || 0),
                                    ...previous7Days.map(dayData => dayData[name]).map(v => v || 0),
                                    today[name] || 0, 0);
  }

  today.sort_change_cases_per_1000k = today.change_cases_per_1000k || lastWeekExclusive.change_cases_per_1000k_avg;
  today.sort_change_cases = today.change_cases || lastWeekExclusive.change_cases_avg;
  today.sort_change_vaccinations_per_1k = today.change_vaccinations > 0 ? lastWeekInclusive.change_vaccinations_per_1k_avg : lastWeekExclusive.change_vaccinations_per_1k_avg;
  today.sort_change_vaccinations = today.change_vaccinations > 0 && yesterday.change_vaccinations > 0 ? today.change_vaccinations : lastWeekExclusive.change_vaccinations_avg;

  data.today = today;
  data.previousWeeks = previousWeeks;
  data.lastWeekExclusive = lastWeekExclusive;
  data.lastWeekInclusive = lastWeekInclusive;
  data.previous7Days = previous7Days;
  data.yesterday = yesterday;

  return data;
}

function normalizePopulation(geo, prov) {
  if (!prov) prov = geo;
  if (geo.population) {
    geo.population15plus = geo.population * (100-(prov["0-14"] || 0)) / 100;
    geo.population2plus = geo.population * (100-(prov["0-1"] || 0)) / 100;
    geo.population12plus = geo.population * (100-(prov["0-1"] || 0)-(prov["2-11"] || 0)) / 100;
    geo.population18plus = geo.population * (100-(prov["0-1"] || 0)-(prov["2-11"] || 0)-(prov["12-17"] || 0)) / 100;
    geo.population40plus = geo.population * (100-(prov["0-1"] || 0)-(prov["2-11"] || 0)-(prov["12-17"] || 0)-(prov["18-29"] || 0)-(prov["30-39"] || 0)) / 100;
  }
  return geo;
}

function normalizeTotal(geo) {
  const todayDate = new Date().toJSON().split('T')[0];
  const [total] = geo.daily.slice(-1);
  if (!geo.data_status || !/reported|progress/i.test(geo.data_status)) {
    if (total?.date === todayDate) {
      if (!total?.change_cases) {
        geo.daily.pop();
      }
    }
  }

  // geo.total = geo.daily[geo.daily.length - 1];
  [geo.total] = geo.daily.slice(-1);
  return geo;
}

function projectVaccineAge(vaccineByAge, prov) {
  const name = prov.code;
  const geo = vaccineByAge[name];
  // for(const [name, geo] of Object.entries(vaccineByAge)) {
    const lastMonth = Object.keys(geo).sort().slice(-4);
    const lastMonthValues = lastMonth.map(w => geo[w]);
    const startDate = new Date(lastMonth[0]).getTime();
    const x = lastMonth.map(d => ((new Date(d).getTime() - startDate) / 24/60/60/1000) + 1);
    const targetX = ((Date.now() - startDate) / 24/60/60/1000) + 1;
    const targetDate = new Date().toISOString().split('T')[0];
    const result = {date: lastMonth[3], name, total:{half: 0, full: 0, doses: 0}, ages:[]};

    const geoPopulation = prov.population;

    for (const w of lastMonthValues) {
      w["70+"] = {
        full: (w["70-79"]?.full || 0) + (w["80+"]?.full || 0),
        half: (w["70-79"]?.half || 0) + (w["80+"]?.half || 0),
        doses: (w["70-79"]?.doses || 0) + (w["80+"]?.doses || 0),
      };
      delete w["70-79"];
      delete w["80+"];
    }

    const ageRanges = [...Object.keys(geo[lastMonth[3]])].filter(a => a !== 'total').sort();
    for (const age of ageRanges) {

      const population = (prov[age] / 100) * geoPopulation;

      for (const w of lastMonthValues) {
        w[age].doses = w[age].half + w[age].full;
      }

      const half = lastMonthValues.map(week => week[age].half);
      const full = lastMonthValues.map(week => week[age].full);
      const doses = lastMonthValues.map(week => week[age].doses);

      const regressionHalf = new PolynomialRegression(x, half, 2);
      const regressionFull = new PolynomialRegression(x, full, 2);
      const regressionDoses = new PolynomialRegression(x, doses, 2);

      const prediction = {
        key: (age === "0-17") ? "12-17" : age,
        half: Math.min(Math.round(regressionHalf.predict(targetX)), population),
        full: Math.min(Math.round(regressionFull.predict(targetX)), population),
        doses: Math.min(Math.round(regressionDoses.predict(targetX)), population*2),
        population
      }
      result.total.half += prediction.half;
      result.total.full += prediction.full;
      result.total.doses += prediction.doses;

      result.ages.push(prediction);

      try {
        prediction.halfETA = Math.round(new PolynomialRegression(half.slice(-2), x.slice(-2), 1).predict(population * 0.7));
        prediction.fullETA = Math.round(new PolynomialRegression(full.slice(-2), x.slice(-2), 1).predict(population * 0.7));
        prediction.dosesETA = Math.round(new PolynomialRegression(doses.slice(-2), x.slice(-2), 1).predict(population * 2 * 0.7));
      }
      catch {}

      // if (name === 'CA') console.log(name, age, x, half, prediction.half, prediction.halfETA);
      // if (name === 'CA') console.log(name, age, x, full, prediction.full, prediction.fullETA);
      // if (name === 'CA') console.log(name, age, x, doses, prediction.doses, prediction.dosesETA);
    }
    result.ages.unshift({key: "0-11", full: 0, half: 0, doses: 0});

  //   projectedVaccineByAge[name] = result;
  // }
  //
  return result;
}

module.exports = async function() {
  const fullData = JSON.parse(fs.readFileSync('_data/covid19tracker.ca/data.json', 'utf-8'));
  // super quick hack to plot ages and demographics. the data from canada.ca is ~2w old
  const vaccineByAge = JSON.parse(fs.readFileSync('_data/canada.ca/vaccination-coverage-byAgeAndSex.json', 'utf-8'));

  const todayDatePST = new Date(Date.now() - 7*60*60*1000).toJSON().split('T')[0];

  //re-organize the data structure
  fullData['CA'].data_status = [...Object.keys(fullData)]
                                .filter(k => k !== 'CA')
                                .map(k => fullData[k].data_status)
                                .filter(s => !/reported|no report/i.test(s))
                                .reduce((p, c) => /In Progress/i.test(p + c) ? "In Progress" : "Waiting For Report", null) || "Reported";
  const data = Object.keys(fullData).map(k => Object.assign(fullData[k], {code: k, iso3166: k === 'PE' ? 'PEI' : k === 'NT' ? 'NWT' : k }));

  for (const prov of data) {
    prov["0-11"] = prov["0-1"] + prov["2-11"];
    prov["0-17"] = prov["0-1"] + prov["2-11"] + prov["12-17"];
    prov["18-64"] = prov["18-29"] + prov["30-39"] + prov["40-49"] + prov["50-59"] + Math.round(prov["60-69"]/2);
    prov["65+"] = 100 - prov["18-64"] - prov["0-17"];

    prov.complete = /reported/i.test(prov.data_status);
    normalizeTotal(prov);
    normalizePopulation(prov);
    normalizeVaccine(prov);
    prov.vaccineByAge = projectVaccineAge(vaccineByAge, prov);

    // only real health regions
    prov.regions = prov.regions?.filter(r => r.daily && !['NT', 'NU', 'PE', 'YT'].includes(r.province)) || [];

    // that have total values
    prov.regions = prov.regions?.filter(r => Number.isInteger(r.daily[r.daily.length - 1]?.total_vaccinations) ||  Number.isInteger(r.daily[r.daily.length - 1]?.total_cases)) || [];
    prov.regions = prov.regions?.sort((a,b) => b.population - a.population);

    for (const region of prov.regions) {
      region.complete = prov.complete;
      region.data_status = prov.data_status;
      normalizeTotal(region);
      normalizePopulation(region);
      normalizeVaccine(region);
    }
    if (/Reported/.test(prov.data_status) && prov.total.date !== todayDatePST) {
      prov.data_status = "Waiting For Report";
    }
  }

  return data.sort((a,b) => b.population - a.population);
};
