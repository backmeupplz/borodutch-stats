export function dailyCreatedConfig() {
  return [
    {
      $project: {
        _id: '$_id',
        time: {
          $divide: [
            {
              $subtract: [
                { $subtract: [new Date(), '$createdAt'] },
                {
                  $mod: [
                    { $subtract: [new Date(), '$createdAt'] },
                    24 * 60 * 60 * 1000,
                  ],
                },
              ],
            },
            24 * 60 * 60 * 1000,
          ],
        },
      },
    },
    {
      $group: { _id: '$time', count: { $sum: 1 } },
    },
    { $sort: { _id: -1 } },
  ]
}

export const templatesCount = [
  { $match: { 'templates.0': { $exists: true } } },
  {
    $group: {
      _id: null,
      templates: { $sum: { $size: '$templates' } },
    },
  },
]
