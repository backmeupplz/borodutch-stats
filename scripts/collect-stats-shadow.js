require('../dist/helpers/shadowCollection')
  .runShadowCollection()
  .then(function (result) {
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  })
  .catch(function (err) {
    console.error('Shadow collection failed:', err.message || err)
    process.exit(1)
  })
