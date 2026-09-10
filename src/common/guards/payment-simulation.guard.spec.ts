import { NotFoundException } from '@nestjs/common';
import { PaymentSimulationGuard } from './payment-simulation.guard';

describe('PaymentSimulationGuard', () => {
  const guard = new PaymentSimulationGuard();
  const original = process.env.PAYMENT_SIMULATION;

  afterEach(() => {
    process.env.PAYMENT_SIMULATION = original;
  });

  it('laisse passer quand PAYMENT_SIMULATION=true', () => {
    process.env.PAYMENT_SIMULATION = 'true';
    expect(guard.canActivate()).toBe(true);
  });

  it('renvoie 404 quand le flag est absent', () => {
    delete process.env.PAYMENT_SIMULATION;
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('renvoie 404 quand le flag vaut autre chose que "true"', () => {
    process.env.PAYMENT_SIMULATION = 'false';
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});
