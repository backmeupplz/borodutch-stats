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
  if (array[0]._id < 0) {
    const diff = 0 - array[0]._id
    array = array.forEach(v => (v += diff))
  }
  return result
}
