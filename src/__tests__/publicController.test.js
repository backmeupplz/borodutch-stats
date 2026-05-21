jest.mock('../../dist/helpers/arr', () => ({
  arr: jest.fn().mockResolvedValue([
    {
      annualRecurringRevenue: 1200,
      monthlyRecurringRevenue: 100,
    },
  ]),
}))

jest.mock('../../dist/helpers/stats', () => ({
  stats: {
    borodutch: [1, 2, 3],
    userCount: {
      count: 123,
    },
  },
}))

jest.mock('../../dist/helpers/summary', () => ({
  projectStats: jest.fn().mockImplementation((project) => {
    if (project === 'randy') {
      return {
        randym: {
          userCount: 10,
        },
      }
    }

    return {
      [project]: {
        userCount: 5,
      },
    }
  }),
  summary: jest.fn().mockReturnValue({
    userCount: {
      count: 123,
    },
  }),
}))

jest.mock('../../dist/helpers/userCount', () => ({
  userCount: {
    count: 123,
    history: [['1710000000000', '123']],
    reachability: {},
  },
  userCountReachability: {
    bots: {},
    total: {},
  },
}))

const PublicController = require('../../dist/controllers/public').default

describe('public controller', () => {
  let controller

  beforeEach(() => {
    controller = new PublicController()
  })

  test('/stats returns the full stats payload', () => {
    const ctx = {}

    controller.stats(ctx)

    expect(ctx.body).toEqual({
      borodutch: [1, 2, 3],
      userCount: {
        count: 123,
      },
    })
  })

  test('/stats/:project returns the requested project payload', () => {
    const ctx = {
      params: {
        project: 'randy',
      },
    }

    controller.projectStats(ctx)

    expect(ctx.body).toEqual({
      randym: {
        userCount: 10,
      },
    })
  })

  test('/count returns count and history payload', () => {
    const ctx = {}

    controller.count(ctx)

    expect(ctx.body).toEqual({
      count: 123,
      history: [['1710000000000', '123']],
      reachability: {},
    })
  })

  test('/arr returns ARR data', async () => {
    const ctx = {}

    await controller.arr(ctx)

    expect(ctx.body).toEqual([
      {
        annualRecurringRevenue: 1200,
        monthlyRecurringRevenue: 100,
      },
    ])
  })
})
