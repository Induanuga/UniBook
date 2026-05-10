// src/__tests__/utilisationAggregator.test.ts
// Unit tests for UtilisationAggregator — repository is mocked.

import { UtilisationAggregator } from '../services/UtilisationAggregator';

function makeMockRepo() {
  return {
    upsertSnapshot: jest.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => jest.clearAllMocks());

describe('UtilisationAggregator.increment()', () => {
  test('calls upsertSnapshot with delta +1', async () => {
    const repo = makeMockRepo();
    const agg  = new UtilisationAggregator(repo as never);

    await agg.increment(
      'res-1', 'CS',
      new Date('2026-05-01T10:00:00Z'),
      new Date('2026-05-01T12:00:00Z'),
    );

    expect(repo.upsertSnapshot).toHaveBeenCalledWith(
      'res-1', 'CS',
      expect.any(Date), expect.any(Date),
      +1,
    );
  });
});

describe('UtilisationAggregator.decrement()', () => {
  test('calls upsertSnapshot with delta -1', async () => {
    const repo = makeMockRepo();
    const agg  = new UtilisationAggregator(repo as never);

    await agg.decrement(
      'res-1', 'CS',
      new Date('2026-05-01T10:00:00Z'),
      new Date('2026-05-01T12:00:00Z'),
    );

    expect(repo.upsertSnapshot).toHaveBeenCalledWith(
      'res-1', 'CS',
      expect.any(Date), expect.any(Date),
      -1,
    );
  });
});
