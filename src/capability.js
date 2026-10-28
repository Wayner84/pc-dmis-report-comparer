const finiteValues = values => values.map(Number).filter(Number.isFinite);

export function calculateCapability(values, nominal, lowerLimit, upperLimit) {
  const samples = finiteValues(values);
  const base = {
    sampleCount: samples.length,
    mean: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null,
    standardDeviation: null,
    minus3Sigma: null,
    plus3Sigma: null,
    cp: null,
    cpu: null,
    cpl: null,
    cpk: null,
    sigmaLevel: null,
    toleranceUsedPercent: null,
    rating: 'INSUFFICIENT DATA',
  };
  if (samples.length < 2 || !Number.isFinite(nominal) || !Number.isFinite(lowerLimit)
    || !Number.isFinite(upperLimit) || upperLimit <= lowerLimit) return base;

  const variance = samples.reduce((sum, value) => sum + (value - base.mean) ** 2, 0) / (samples.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const withinLimits = base.mean >= lowerLimit && base.mean <= upperLimit;
  if (standardDeviation === 0) {
    return {
      ...base,
      standardDeviation,
      minus3Sigma: base.mean,
      plus3Sigma: base.mean,
      cp: Infinity,
      cpu: withinLimits ? Infinity : -Infinity,
      cpl: withinLimits ? Infinity : -Infinity,
      cpk: withinLimits ? Infinity : -Infinity,
      sigmaLevel: withinLimits ? Infinity : -Infinity,
      toleranceUsedPercent: 0,
      rating: withinLimits ? 'CAPABLE' : 'NOT CAPABLE',
    };
  }

  const cp = (upperLimit - lowerLimit) / (6 * standardDeviation);
  const cpu = (upperLimit - base.mean) / (3 * standardDeviation);
  const cpl = (base.mean - lowerLimit) / (3 * standardDeviation);
  const cpk = Math.min(cpu, cpl);
  return {
    ...base,
    standardDeviation,
    minus3Sigma: base.mean - 3 * standardDeviation,
    plus3Sigma: base.mean + 3 * standardDeviation,
    cp,
    cpu,
    cpl,
    cpk,
    sigmaLevel: cpk * 3,
    toleranceUsedPercent: (6 * standardDeviation / (upperLimit - lowerLimit)) * 100,
    rating: cpk >= 1.33 ? 'CAPABLE' : cpk >= 1 ? 'MARGINAL' : 'NOT CAPABLE',
  };
}
