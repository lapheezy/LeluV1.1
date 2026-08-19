import assert from 'node:assert/strict';
import registerProviders from '../src/core/RegisterProvider.ts';
import Planner from '../src/core/Planner.ts';
import ProviderQueue from '../src/core/ProviderQueue.ts';
import ResearchCoordinator from '../src/providers/ResearchCoordinator.ts';
import type Provider from '../src/providers/Provider.ts';

async function main(): Promise<void> {
  const registry = registerProviders();
  assert.ok(registry.size > 0, 'ProviderRegistry should register providers');

  const providers = registry.all();
  assert.ok(providers.length > 0, 'Registry should contain providers');
  for (const provider of providers) {
    assert.equal(typeof provider.name, 'string');
    assert.equal(typeof provider.canSearch, 'function');
    assert.equal(typeof provider.search, 'function');
    assert.ok(Array.isArray(provider.capabilities));
  }

  const planner = new Planner();
  const planned = planner.plan('weather in london', providers);
  assert.ok(planned.length > 0, 'Planner should return at least one provider');
  assert.ok(planned.every(provider => provider.enabled), 'Planner should only return enabled providers');

  const queue = new ProviderQueue();
  const results = await Promise.all(
    planned.slice(0, 2).map(provider => queue.enqueue(provider, 'weather in london'))
  );
  assert.ok(results.every(items => Array.isArray(items)), 'Queue should return arrays of results');

  const coordinator = new ResearchCoordinator(registry);
  const coordinated = await coordinator.search('weather in london');
  assert.ok(Array.isArray(coordinated), 'Coordinator should return a result array');
  assert.ok(coordinated.every(item => typeof item.id === 'string' && typeof item.title === 'string' && typeof item.content === 'string' && typeof item.source === 'string' && typeof item.confidence === 'number'), 'Coordinator results should follow the contract');
  assert.ok(coordinated.every((item, index, array) => array.findIndex(candidate => (candidate.url ?? candidate.id) === (item.url ?? item.id)) === index), 'Coordinator should remove duplicate URLs');

  const sorted = [...coordinated].sort((a, b) => b.confidence - a.confidence);
  assert.deepEqual(coordinated, sorted, 'Coordinator should sort results by confidence');

  console.log('Provider pipeline verification passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
