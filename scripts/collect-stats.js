require('../dist/helpers/userCount')
  .runCollection()
  .then(function (result) {
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  })
  .catch(function (err) {
    console.error('Collection failed:', err)
    process.exit(1)
  })
