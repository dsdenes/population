const _ = require('lodash');
const Debug = require('debug');
const log = Debug('population');
log.log = console.log.bind(console);

module.exports = function genetic(options = {}) {

  options = _.defaultsDeep(options, {
    eliteRatio: 0.1,
    newBloodRatio: 0.05,
    mutationProbability: 0.5,
    targetFitness: 1,
    targetFitDidntChange: 50000,
    targetGeneration: 50000,
    population: [],
    mutator: () => {},
    crossover: () => {},
    getFitness: () => {},
    orderByFitness,
    eliminateMembers: population => population,
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

  log(`Population size: ${options.population.length}`);
  log(`Elite size: ${eliteCount}`);
  log(`Offspring size: ${offspringCount}`);

  return Object.freeze({
    run
  });

  async function run(population = options.population, recursive = false) {
    population = await attachFitness(population);
    population = options.orderByFitness(population);

    log(`Before elimination: ${population.length}`);
    population = await options.eliminateMembers(population);
    log(`After elimination: ${population.length}`);

    population = attachRank(population);

    population.map(member => {
      Debug('population:evaluated')(`${_.round(member.fitness, 6)} ${member.rank} ${member.serialized}`);
    });

    population = options.orderByFitness(population);
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

    log(bestFitness);

    if (stopCondition(population)) {
      log('STOP CONDITION OCCURRED');
      return population;
    } else {
      const newPopulation = evolve(population);
      return run(newPopulation, true);
    }
  }

  function stopCondition(population) {
    if (_.map(population, 'fitness')[0] >= options.targetFitness) {
      log(`Awesome fitness found, better than ${options.targetFitness}`);
      return true;
    } else if (fitNotChanged >= options.targetFitDidntChange) {
      log(`Fit didn't change for ${options.targetFitDidntChange} generation.`);
      return true;
    } else if (generation++ >= options.targetGeneration) {
      log(`Reached ${options.targetGeneration} generation.`);
      return true;
    }
  }

  function evolve(population) {
    const parents = selectParentPairs(population);
    const offspringPopulation = generateAllOffspring(parents);
    const mutatedPopulation = mutatePopulation(offspringPopulation);
    const newPopulation = mixPopulations(population, mutatedPopulation);

    newPopulation.map(member => {
      Debug('population:new')(`${member.serialized}`);
    });

    const uniqNewPopulation = makePopulationUniq(newPopulation);
    const newBloodPopulation = _.concat(uniqNewPopulation,
      _.times(originalPopulationLength - uniqNewPopulation.length, options.getRandomMember));
    return newBloodPopulation;
  }

  function attachFitness(population) {
    return Promise.all(population.map(async (member) => {
      member.fitness = await options.getFitness(member);
      return member;
    }));
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
      Debug('population:elite')(`${_.round(member.fitness, 6)} ${member.rank} ${member.serialized}`);
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