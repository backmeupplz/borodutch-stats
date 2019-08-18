export function fixAggregation(array: any) {
  const result = []
  let previousId = 0
  array.forEach(element => {
    const index = element._id
    if (previousId === index) {
      result.push(element)
    } else if (index - previousId === 1) {
      result.push(element)
    } else {
      const diff = index - previousId - 1
      for (let i = 0; i < diff; i++) {
        result.push({
          _id: previousId + i + 1,
          count: 0,
        })
      }
      result.push(element)
    }
    previousId = index
  })
  return result
}
