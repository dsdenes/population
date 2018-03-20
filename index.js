const _ = require('lodash');
const Debug = require('debug');
const debugs = {};

function debug(message, base = 'default') {
  if (!(base in debugs)) {
    debugs[base] = base === 'default' ? Debug(`population`) : Debug(`population:${base}`);
    debugs[base].log = console.log.bind(console);
  }
  debugs[base](message);
}

module.exports = function genetic(options = {}) {

  options = _.defaultsDeep(options, {
    eliteRatio: 0.1,
    newBloodRatio: 0.05,
    mutationProbability: 0.5,
    targetFitness: null,
    targetFitDidntChange: 50000,
    targetGeneration: 50000,
    population: [],
    mutator: () => {},
    crossover: () => {},
    getFitness: () => {},
    attachAllFitness: null,
    orderByFitness,
    beforeFitnessCalculated: population => population,
    afterFitnessCalculated: population => population,
    hash: () => {},
    eliteUniqHash: () => {},
    getRandomMember: () => {},
    onBestFitness: () => {},
    onGenerationBestFitness: () => {}
  });

  let generation = 0;

  const originalPopulationLength = options.population.length;
  const eliteRatio = options.eliteRatio;
  const eliteCount = _.floor(options.population.length * eliteRatio);
  const newBloodRatio = options.newBloodRatio;
  const newBloodCount = _.floor(options.population.length * newBloodRatio);
  const offspringCount = options.population.length - eliteCount - newBloodCount;
  let lastBestFitness = 0;
  let bestFitnessEver = null;
  let fitNotChanged = 0;

  debug(`Population size: ${options.population.length}`, 'debug');
  debug(`Elite size: ${eliteCount}`, 'debug');
  debug(`Offspring size: ${offspringCount}`, 'debug');
  debug(`New blood size: ${newBloodCount}`, 'debug');

  return Object.freeze({
    run
  });

  async function run(population = options.population, recursive = false) {
    debug(`Population count: ${population.length}`, 'debug');
    population = await options.beforeFitnessCalculated(population);
    population = await attachFitness(population);
    population = await options.afterFitnessCalculated(population);
    debug(`After afterFitnessCalculated called: ${population.length}`, 'debug');

    population = options.orderByFitness(population);
    population = attachRank(population);

    population.map(member => {
      debug(`${_.round(member.fitness, 6)} ${member.rank} ${member.serialized}`, 'silly');
    });

    const bestFitness = _.map(population, 'fitness')[0];

    options.onGenerationBestFitness(bestFitness);

    if (lastBestFitness !== bestFitness || !recursive) {
      fitNotChanged = 0;
    } else {
      fitNotChanged++;
    }
    lastBestFitness = bestFitness;

    if (bestFitnessEver === null || bestFitnessEver < bestFitness) {
      options.onBestFitness(bestFitness, population);
      bestFitnessEver = bestFitness;
    }

    debug(`Generation: ${generation + 1}, Best fitness: ${bestFitness}, Fit not changed: ${fitNotChanged}`);

    if (stopCondition(population)) {
      return population;
    } else {
      const newPopulation = evolve(population);
      return run(newPopulation, true);
    }
  }

  function stopCondition(population) {
    if (options.targetFitness !== null && _.map(population, 'fitness')[0] >= options.targetFitness) {
      debug(`Awesome fitness found, better than ${options.targetFitness}`);
      return true;
    } else if (fitNotChanged >= options.targetFitDidntChange) {
      debug(`Fit didn't change for ${options.targetFitDidntChange} generation.`);
      return true;
    } else if (++generation >= options.targetGeneration) {
      debug(`Reached ${options.targetGeneration} generation.`);
      return true;
    }
  }

  function evolve(population) {
    const parents = selectParentPairs(population);
    const offspringPopulation = generateAllOffspring(parents);
    const mutatedPopulation = mutatePopulation(offspringPopulation);
    const newPopulation = mixPopulations(population, mutatedPopulation);

    newPopulation.map(member => {
      debug(`${member.serialized}`, 'silly');
    });

    const uniqNewPopulation = makePopulationUniq(newPopulation);
    const newBloodPopulation = _.concat(uniqNewPopulation,
      _.times(originalPopulationLength - uniqNewPopulation.length, options.getRandomMember));
    return newBloodPopulation;
  }

  function attachFitness(population) {
    if (_.isFunction(options.attachAllFitness)) {
      return options.attachAllFitness(population);
    } else {
      return Promise.all(population.map(async (member) => {
        member.fitness = await options.getFitness(member);
        return member;
      }));
    }
  }

  function orderByFitness(population) {
    return _.orderBy(population, ['fitness'], 'desc');
  }

  function attachRank(population) {
    let maxRank = population.length;
    return population.map(member => {
      member.rank = maxRank--;
      return member;
    });
  }

  function selectParentPairs(population) {
    const weightedPopulation = createWeightedPopulation(population);
    return _.times(offspringCount, () => selectParents(weightedPopulation))
  }

  function selectParents(weightedPopulation) {
    return [_.sample(weightedPopulation), _.sample(weightedPopulation)];
  }

  function createWeightedPopulation(population) {
    let weightedPopulation = [];
    population.map(member => {
      _.times(member.rank, () => weightedPopulation.push(member))
    });
    return weightedPopulation;
  }

  function generateAllOffspring(allParents) {
    return allParents.map(generateOffspring);
  }

  function generateOffspring(parents) {
    return options.crossover(parents);
  }

  function mutatePopulation(population) {
    return population.map(member => {
      if (_.random(1, true) <= options.mutationProbability) {
        return options.mutator(member);
      } else {
        return member;
      }
    });
  }

  function mixPopulations(oldPopulation, newPopulation) {
    const elite = getElite(oldPopulation);
    elite.map(member => {
      debug(`${_.round(member.fitness, 6)} ${member.rank} ${member.serialized}`, 'debug');
    });
    return _.concat(elite, newPopulation);
  }

  function getElite(population) {
    const eliteUniqPopulation = getUniqElite(population);
    return _.slice(eliteUniqPopulation, 0, eliteCount);
  }

  function makePopulationUniq(population) {
    return _.uniqBy(population, options.hash)
  }

  function getUniqElite(population) {
    return _.uniqBy(population, options.eliteUniqHash)
  }

};