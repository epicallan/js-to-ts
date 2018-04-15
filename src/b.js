'use strict'
const _ = require('lodash')
const co = require('co')
const Pets = require('../services/pets')
const Users = require('../services/users')
const db = require('../services/db')
const Content = require('../services/content')
const getSVGStringsForRelatednessKaryograms = require('../services/getSVGStringsForRelatednessKaryograms')
const moment = require('moment')
const formatters = require('../formatters')
const emailer = require('../services/emailer')
const cloudinary = require('../services/cloudinary')
const featureUsageTracking = require('../services/featureUsageTracking')

const { flashAndRedirect } = require('./util')

// occasionally we change how we calculate the pair results in the pipeline for a breed, and update the calc version in the pair_results table
const defaultCalcVersion = 3

function monthsSinceDate (date) {
  return date ? Math.round(moment(new Date()).diff(date, 'months', true)) : null
}

exports.shouldShowBreederTools = async function (userId, userIsBreeder, dogs) {
  // as of July 2017, the breeder tools are only available to breeders who own doberman_pinscher
  dogs = dogs || (await Pets.getPetsWithGenotypeByUser(userId))
  const relevantBreed = 'doberman_pinscher'
  let numRelevantBreedDogs = _.filter(dogs, d => d.genotype && d.genotype.breed1code === relevantBreed).length
  return userIsBreeder && numRelevantBreedDogs > 0
}

exports.getIndex = async function (req, res, next) {
  if (await exports.shouldShowBreederTools(req.user.id, req.user.isBreeder)) {
    res.render('breederTools/index')
  } else {
    res.redirect('/members')
  }
}

exports.getDiversity = function (req, res, next) {
  res.render('breederTools/diversity')
}

function getLatLngForUser (breeder) {
  if (breeder && breeder.addressParsed) {
    let addressParsed = _.isString(breeder.addressParsed) ? JSON.parse(breeder.addressParsed) : breeder.addressParsed
    return { lat: addressParsed.lat, lng: addressParsed.lng }
  } else {
    return { lat: null, lng: null }
  }
}

function getOtherDiseaseResults (petHealthCondensed) {
  const filterCommonResultsAndHealthTraits = h => !h.in_health_ids && !h.trait_state_labels
  const formatHealthResult = h => `${h.gene} (${h.health_id}): ${formatHealthStateCategory(h.health_state_category)}`
  const formattedFilteredResults = _.map(_.filter(petHealthCondensed, filterCommonResultsAndHealthTraits), formatHealthResult)
  return formattedFilteredResults.join('; ')
}

exports.getMatchmaker = async function (req, res, next) {
  // the user uses a dropdown select box to choose which pet they want to view the matchmaker for. We persist their choice on the session
  req.session.breederTools = req.session.breederTools || {}
  req.session.breederTools.selectedPetNum = parseInt(req.query.selectpetnum, 10) || req.session.breederTools.selectedPetNum

  const calcVersion = parseInt(req.query.calcVersion, 10) || defaultCalcVersion
  const usersPets = await Pets.getPetsByUserThatHavePairResults(req.user.id, calcVersion)
  const pet = req.session.breederTools.selectedPetNum ? _.find(usersPets, { petNum: req.session.breederTools.selectedPetNum }) : null

  if (!pet) {
    const viewModel = {
      pets: usersPets,
      includeDataTableScripts: true,
      showOwnerReportedBreed: false, // don't need this for purebreds like dobermans; may need this for eg goldendoodles
      viewportMetatag: 'width=1200' // the matchmaker table is too big for responsive design to work, so we use a non-responsive viewport instead
    }
    res.render('breederTools/matchmaker', viewModel)
    return viewModel
  }

  const breedCommonDiseasesInfo = Content.getBreedCommonDiseasesInfo(['doberman_pinscher'])
  const healthIds = _.map(breedCommonDiseasesInfo, 'healthId')

  const healthResults = await Pets.getHealthCondensedByPetId(pet.petId, healthIds)
  const commonDiseaseResults = _.map(breedCommonDiseasesInfo, b => getHealthStateFromHealthCondensed(healthResults, b.healthId))
  const otherDiseaseResults = getOtherDiseaseResults(healthResults)

  const petTraits = await Pets.getTraitsByPetNum(pet.petNum, pet.userId)
  const petBLocus = petTraits.TYRP1
  const petDLocus = petTraits.MLPH_D
  const petTraitGenes = petBLocus + ', ' + petDLocus
  const ageText = makeAgeTextFromDob(pet.dateOfBirth, pet.dateOfBirthEstimated)
  const uniqueTitles = await getDataForMatchmakerTable(req.log, pet.petNum, pet.userId, req.user.breeder, calcVersion, { onlyTitles: true })

  featureUsageTracking.logEvent(featureUsageTracking.eventTypes.MATCHMAKER_TABLE_VIEW, req.user.id, { pet_id: pet.petId })

  req.session.getpetDest = '/members/breeder-tools/matchmaker' // if the user clicks 'edit' on their own pet, the edit screen 'close' button should come right back here

  // get latitude and longitude of current user
  const latLng = getLatLngForUser(req.user.breeder)

  const distanceFilterRanges = [
    {min: 0, max: 50},
    {min: 50, max: 100},
    {min: 100, max: 250},
    {min: 250, max: 500},
    {min: 500, max: 1000},
    {min: 1000, max: 999999}
  ]
  const offspringCoiFilterRanges = [
    {min: 0, max: 20},
    {min: 20, max: 30},
    {min: 30, max: 100}
  ]
  const ageFilterRanges = [
    {min: 0, max: 2},
    {min: 2, max: 4},
    {min: 4, max: 6},
    {min: 6, max: 8},
    {min: 8, max: 10},
    {min: 10, max: 9999}
  ]

  // show all contact requests made by or received by the current user
  const previousContactsSql = `SELECT req.*, s.name AS sender_pet_name, r.name AS recipient_pet_name FROM matchmaker_contact_requests req INNER JOIN pets s ON s.pet_id = req.sender_pet_id INNER JOIN pets r ON r.pet_id = req.recipient_pet_id WHERE sender_user_id = $1 OR recipient_user_id = $1;`
  const previousContacts = await db.queryMany(previousContactsSql, [req.user.id])

  const viewModel = {
    lat: latLng.lat,
    lng: latLng.lng,
    pets: usersPets,
    petTraitGenes,
    dog: pet,
    includeDataTableScripts: true,
    breedCommonDiseasesInfo,
    commonDiseaseResults,
    otherDiseaseResults,
    ageText,
    previousContacts,
    distanceFilterRanges,
    offspringCoiFilterRanges,
    ageFilterRanges,
    uniqueTitles,
    calcVersion,
    showOwnerReportedBreed: false, // don't need this for purebreds like dobermans; may need this for eg goldendoodles
    viewportMetatag: 'width=1200' // the matchmaker table is too big for responsive design to work, so we use a non-responsive viewport instead
  }
  res.render('breederTools/matchmaker', viewModel)
  return viewModel // for testing
}

function formatHealthStateCategory (healthStateCategory) {
  if (healthStateCategory === 'ignore') {
    return 'N/A'
  }
  if (healthStateCategory && healthStateCategory.toLowerCase() === 'atrisk') {
    return 'At Risk'
  }
  return formatters.capitalize(healthStateCategory)
}

function getHealthStateFromHealthCondensed (healthCondensedForPet, healthId) {
  let diseaseResult = _.find(healthCondensedForPet, { health_id: healthId })
  if (!diseaseResult) {
    return 'N/A'
  }
  return formatHealthStateCategory(diseaseResult.health_state_category)
}

// working test route: http://localhost:8000/members/breeder-tools/matchmaker-details?swab_code_a=31001602132942&swab_code_b=31001602121056
exports.getDetails = async function (req, res, next) {
  function sort (a, b) {
    return a > b ? [b, a] : [a, b]
  }
  function flattenTraitGroups (g) {
    let flat = []
    let keys = _.keys(g).sort()
    _.forEach(keys, function (key) {
      flat = flat.concat(g[key])
    })
    return flat
  }
  function getTraitCall (flatTraits, traitGeneId) {
    return (_.find(flatTraits, { trait_gene_id: traitGeneId }) || { call: 'n/a' }).call
  }

  // get swab codes and sort them
  const { myPetNum, theirHandle } = req.query
  req.log.info({ myPetNum, theirHandle }, 'getDetails')

  if (!myPetNum || !theirHandle) {
    return flashAndRedirect(req, res, '/members/breeder-tools/matchmaker', 'Tried to access matchmaker detail page but did not provide two pets to compare')
  }

  const theirPet = await Pets.getPetByHandle(theirHandle)
  let { isBreeder, breeder } = await Users.getUserByID(theirPet.userId)

  const allMyPets = await Pets.getPetsByUser(req.user.id)
  const myPet = _.find(allMyPets, p => p.petNum === myPetNum)
  const isTheirPetOneOfMyDogs = _.filter(allMyPets, p => p.handle === theirHandle).length > 0

  // in the `pair_results` table, swab_code_b > swab_code_a
  const [swabCodeA, swabCodeB] = sort(myPet.swab, theirPet.swab)
  const karyogramSvgStringsAndChromosomeNumbers = await getSVGStringsForRelatednessKaryograms(swabCodeA, swabCodeB, { total_width: 300, bar_height: 20, colors: [ '#F0F0F0', '#F99F1E', '#F15B5C' ] })

  const breedCommonDiseasesInfo = Content.getBreedCommonDiseasesInfo(['doberman_pinscher'])
  const healthIds = _.map(breedCommonDiseasesInfo, 'healthId')
  const petIds = [myPet.petId, theirPet.petId]

  const healthByPet = await Pets.getHealthCondensedForPets(petIds, healthIds)
  const healthRows = _.map(breedCommonDiseasesInfo, i => ({
    disorder_name: i.condition.disorder_name,
    subdisorder_name: i.condition.subdisorder_name,
    myPetHealthState: getHealthStateFromHealthCondensed(healthByPet[myPet.petId], i.healthId, true),
    theirPetHealthState: (theirPet.publicShare.health || isTheirPetOneOfMyDogs) ? getHealthStateFromHealthCondensed(healthByPet[theirPet.petId], i.healthId) : '🔒'
  }))

  let breedList = null
  let breederAddressParsed = null
  // is 'them' a breeder?
  if (isBreeder && breeder) {
    breeder.isBreeder = true
    let otherBreedsNames = []
    if (breeder.otherBreeds && breeder.otherBreeds.length) {
      otherBreedsNames = _.map(breeder.otherBreeds, b => b.breed)
    }
    breedList = [breeder.breed].concat(otherBreedsNames).join(', ')
    if (_.isString(breeder.addressParsed)) {
      if (breeder.addressParsed !== '') {
        try {
          breederAddressParsed = JSON.parse(breeder.addressParsed)
        } catch (err) {
          req.log.error(err, 'failed to parse breeder.AddressParsed ' + breeder.addressParsed)
        }
      }
    } else {
      // not a string, so it's already been parsed
      breederAddressParsed = breeder.addressParsed
    }
  }

  let myTraits = { traitGenotypes: await Pets.getTraitsByPetNum(myPet.petNum, myPet.userId) }
  let theirTraits = { traitGenotypes: await Pets.getTraitsByPetNum(theirPet.petNum, theirPet.userId) }
  // we never show genetic diversity results on public profiles, as it is deemed too sensitive by breeders (and many consumer dogs originally came from breeders!)
  // so we exclude anything with subcategory_display_order = 7, as these are all the genetic diversity metrics
  Pets.makeTraitsResults(myTraits, [ 7 ])
  Pets.makeTraitsResults(theirTraits, [ 7 ])
  let myTraitsFlat = flattenTraitGroups(myTraits.traits.grouped)
  let theirTraitsFlat = flattenTraitGroups(theirTraits.traits.grouped)
  let getGeneIds = traits => _.map(traits, f => ({ trait_gene_id: f.trait_gene_id, trait_name: f.trait_name }))
  let superSetTraitGeneIds = _.uniq(getGeneIds(myTraitsFlat).concat(getGeneIds(theirTraitsFlat)), 'trait_gene_id')
  let traitsRows = _.map(superSetTraitGeneIds, t => ({
    trait_name: t.trait_name,
    trait_gene_id: t.trait_gene_id,
    myCall: getTraitCall(myTraitsFlat, t.trait_gene_id),
    theirCall: (theirPet.publicShare.traits || isTheirPetOneOfMyDogs) ? getTraitCall(theirTraitsFlat, t.trait_gene_id) : '🔒'
  }))

  const calcVersion = req.query.calcVersion || defaultCalcVersion
  let allOffspringCOIs = await getDataForMatchmakerTable(req.log, myPet.petNum, myPet.userId, req.user.breeder, calcVersion, { onlyCOIs: true })
  let offspringCOI = _.filter(allOffspringCOIs, { pet_id: theirPet.petId })[0]
  offspringCOI.potentialMate = true

  // filter on sender_user_id to see all contact requests made from this user for any of their pets, to this recipient pet
  // filter only on recipient_pet_id and NOT recipient_user_id, since we want to show prior contact even if the recipient pet moved to a different user's account since the contact request
  const previousContactsSql = `SELECT *, s.name AS sender_pet_name FROM matchmaker_contact_requests req INNER JOIN pets s ON s.pet_id = req.sender_pet_id WHERE sender_user_id = $1 AND recipient_pet_id = $2;`
  const previousContacts = await db.queryMany(previousContactsSql, [req.user.id, theirPet.petId])

  const videos = await Pets.getVideosForPetId(theirPet.petId)
  const videoTags = _.map(videos, video => ({
    tagMedium: cloudinary.makeTag(video.public_id, 600, video.rotation_angle),
    tagSmall: cloudinary.makeTag(video.public_id, 300, video.rotation_angle)
  }))

  const viewModel = {
    healthRows,
    traitsRows,
    breeder,
    breedList,
    myPet,
    theirPet,
    previousContacts,
    breederAddressParsed,
    karyogramSvgStringsAndChromosomeNumbers,
    allOffspringCOIs,
    offspringCOI,
    videoTags
  }
  res.render('breederTools/details', viewModel)

  featureUsageTracking.logEvent(featureUsageTracking.eventTypes.MATCHMAKER_PAIR_DETAILS_VIEW, req.user.id, { pet_id: myPet.petId, other_pet_id: theirPet.petId })

  return viewModel // for testing
}

exports.postDetails = function (req, res, next) {
  co(function * () {
    // first, deal with any data updates that might have been provided and immediately return
    for (let dataType of ['UserPhone', 'BreederPhone', 'BreederEmail']) {
      let submitFieldName = 'submit' + dataType
      let dataFieldName = 'provide' + dataType
      if (req.body[submitFieldName]) {
        const newValue = _.trim(req.body[dataFieldName])
        if (newValue) {
          if (dataType === 'UserPhone') {
            yield Users.updatePhone(req.user.id, newValue)
          } else if (dataType === 'BreederPhone') {
            req.user.breeder.phone = newValue
            yield Users.updateBreederProfile(req.user.id, req.user.breeder, req.user.id)
          } else if (dataType === 'BreederEmail') {
            req.user.breeder.email = newValue
            yield Users.updateBreederProfile(req.user.id, req.user.breeder, req.user.id)
          }
          req.flash('info', {msg: 'Added contact info: ' + newValue})
        } else {
          req.flash('errors', {msg: 'No value provided for ' + dataType})
        }
        return res.redirect(req.originalUrl)
      }
    }

    if (!req.body.message) {
      req.flash('errors', {msg: 'Blank messages are not permitted. Please write a message.'})
      return res.redirect('/members/breeder-tools/matchmaker-details')
    }

    const myPet = yield Pets.getPetByHandle(req.body.myHandle)
    const theirPet = yield Pets.getPetByHandle(req.body.theirHandle)
    const recipient = yield Users.getUserByID(theirPet.userId)

    let emailOptions = {
      to: recipient.email,
      bcc: 'ryan@embarkvet.com,mbarton@embarkvet.com',
      from: 'Embark for Breeders <breeders@embarkvet.com>',
      subject: 'Embark Matchmaker: ' + _.trim(req.body.subject)
    }

    let contacts = []
    if (req.body.preferUserEmail) {
      contacts.push('Email: ' + req.user.email)
      emailOptions.replyto = req.user.email
    }
    if (req.user.breeder.email && req.body.preferBreederEmail) {
      contacts.push('Email: ' + req.user.breeder.email)
      emailOptions.replyto = req.user.breeder.email
    }
    if (req.body.preferUserPhone && req.user.profile.phone) {
      contacts.push('Phone: ' + req.user.profile.phone)
    }
    if (req.body.preferBreederPhone && req.user.breeder.phone) {
      contacts.push('Phone: ' + req.user.breeder.phone)
    }

    const subject = _.trim(req.body.subject)

    const preamble = `
An Embark breeder has sent you the message below via our Matchmaker tool. Please contact them directly if you are interested. ${emailOptions.replyto ? '' : 'Do not reply to this email.'}
Their name: ${req.user.profile.name}

-----------------

`
    let message = `${req.body.message}

Contact details:
` + contacts.join('\n')

    emailOptions.text = preamble + message
    emailer.sendMail(emailOptions)

    emailer.sendMail({
      to: req.user.email,
      bcc: 'ryan@embarkvet.com,mbarton@embarkvet.com',
      from: 'Embark for Breeders <breeders@embarkvet.com>',
      subject: 'Contact request processed for ' + theirPet.name,
      text: `We have sent the message below to the owner of ${theirPet.name}. Expect them to contact you soon if they are interested.

-----------------

` + message
    })

    let inAppMessage = {
      subject: `Matchmaker contact request`,
      body: `You have received a new matchmaker contact request regarding ${theirPet.name} from ${req.user.profile.name}: ${message}`
    }
    yield Users.addMessageForUser(recipient.id, inAppMessage)

    req.flash('success', {msg: 'Thank you. Your contact request has been processed.'})

    res.redirect(req.originalUrl)

    const insert = [
      ['recipient_user_id', '$', recipient.id],
      ['recipient_email', '$', recipient.email],
      ['recipient_pet_id', '$', theirPet.petId],
      ['recipient_handle', '$', theirPet.handle],
      ['sender_user_id', '$', req.user.id],
      ['sender_email', '$', req.user.email],
      ['sender_pet_id', '$', myPet.petId],
      ['sender_handle', '$', myPet.handle],
      ['subject', '$', subject],
      ['message', '$', message]
    ]
    yield db.insert('matchmaker_contact_requests', insert)
  }).catch(next)
}

const offspringGeneLookup = {
  'XXXX': 'XX',
  'XXXx': 'XX / Xx',
  'XXxx': 'Xx',
  'XxXX': 'XX / Xx',
  'XxXx': 'XX / Xx / xx',
  'Xxxx': 'Xx / xx',
  'xxXX': 'Xx',
  'xxXx': 'Xx / xx',
  'xxxx': 'xx'
}

function offspringGenesCannotBeComputedFromParent (parent) {
  return !parent || parent === 'No Call' || parent === 'CONFLICT'
}

// call like ('BB', 'Bb', 'B', 'b') => 'BB / Bb'
function getOffspringGenesFor (parentA, parentB, majorGene, minorGene) {
  if (offspringGenesCannotBeComputedFromParent(parentA) || offspringGenesCannotBeComputedFromParent(parentB)) {
    return 'n/a'
  }
  // translates the actual genes into arbitrary X and x letters so that we can use offspringGeneLookup for any gene letters
  let combinedParents = parentA + parentB
  let translations = [{external: majorGene, internal: 'X'}, {external: minorGene, internal: 'x'}]
  for (let translation of translations) {
    let regex = new RegExp(translation.external, 'g')
    combinedParents = combinedParents.replace(regex, translation.internal)
  }
  let offspringGenes = offspringGeneLookup[combinedParents]
  for (let translation of translations) {
    let regex = new RegExp(translation.internal, 'g')
    offspringGenes = offspringGenes.replace(regex, translation.external)
  }
  return offspringGenes
}

exports.postFetchMatchmakerDataTable = async function (req, res, next) {
  const petNum = parseInt(req.body.petNum, 10)
  const calcVersion = parseInt(req.body.calcVersion, 10)
  req.log.info({ petNum, calcVersion }, 'postFetchMatchmakerDataTable')
  const data = await getDataForMatchmakerTable(req.log, petNum, req.user.id, req.user.breeder, calcVersion)
  res.send({ data })
  return data // for testing
}

function formatMonths (mths) {
  return `${Math.floor(mths / 12)} yrs ${mths % 12} mths`
}
function makeAgeTextFromDob (dateOfBirth, isEstimated) {
  if (dateOfBirth) {
    let ageInMonths = monthsSinceDate(dateOfBirth)
    let estimated = isEstimated ? ' (est.)' : ''
    return formatMonths(ageInMonths) + estimated
  } else {
    return 'n/a'
  }
}
async function getDataForMatchmakerTable (log, petNum, userId, userBreederProfile, calcVersion, options = { onlyTitles: false, onlyCOIs: false }) {
  // unlike datatable.generateServerSideDataTable, this returns the entire data set to the client, and all sorting and filtering is then done client-side
  // options object:
  //   Pass `onlyTitles: true` to just receive a combined list of prefix and suffix titles (e.g. to populate the titles filter)
  //   Pass `onlyCOIs: true` to just receive a list of all the expected offspring COIs
  const concat3 = (a1, a2, a3) => a1.concat(a2, a3)
  const concat4 = (a1, a2, a3, a4) => concat3(a1, a2, a3).concat(a4)

  const showOwnerReportedBreed = false // MUST match the value used when the table skeleton was drawn. See above.

  function getCoiTrafficLightColor (coi, ancestryLabel) {
    if (coi < 20) {
      return 'text-green'
    } else if (coi < 30) {
      return 'text-orange'
    } else {
      return 'text-red'
    }
  }

  log.info({ petNum, userId, calcVersion }, 'getRawDataForMatchmakerTable')

  // for testing the 'data loading' screen on the client side:
  // yield new Promise(resolve => setTimeout(resolve, 5000))

  const userLatLng = getLatLngForUser(userBreederProfile)

  const pet = await Pets.getPetByPetNum(petNum, userId)

  const petTraits = await Pets.getTraitsByPetNum(pet.petNum, pet.userId)
  const petBLocus = petTraits.TYRP1
  const petDLocus = petTraits.MLPH_D

  const otherSex = pet.sex === 'm' ? 'f' : 'm'

  // show other dogs of the same breed that are intact and of the opposite gender and not private profiles, for which we have relatedness data
  // for performance, do INNER JOINs onto 'pairs' and then onto 'dogs' in the other CTEs to keep them small. Without these it takes >11secs to run, with these <0.1secs (as of May 2017)
  const sql = `
  WITH
  pairs AS (
    SELECT * FROM pair_results WHERE (swab_code_a = '${pet.swab}' OR swab_code_b = '${pet.swab}') AND calc_version = $1
  ),
  dogs AS (
    SELECT
      pet_id, user_id, name, handle, sex, profile, date_of_birth, date_of_birth_estimated, privacy, user_name, date_part('year', age(NOW(), date_of_birth)) AS age_years, breeder, is_breeder, swab_code
    FROM
      pets_info
        INNER JOIN
      pairs ON pets_info.swab_code = pairs.swab_code_a OR pets_info.swab_code = pairs.swab_code_b
    WHERE
    -- breed1code = 'doberman_pinscher'  -- only show dogs of the same breed
    breed1pct = 100  -- only show purebred dogs
    AND sex = '${otherSex}'  -- only show dogs of the opposite sex
    AND intact != 'f'  -- don't show fixed (neuteredOrSpayed) dogs, who cannot breed
    AND is_nonhealth_ready = TRUE  -- don't show dogs whose results have not yet been released to their owner
    AND deleted_at IS NULL  -- don't show deleted dogs
  ),
  b_locus AS (
    SELECT t.swab_code, VALUE
    FROM genotypes_traits t
    INNER JOIN dogs ON dogs.swab_code = t.swab_code
    WHERE trait_gene_id = 'TYRP1'
  ),
  d_locus AS (
    SELECT t.swab_code, VALUE
    FROM genotypes_traits t
    INNER JOIN dogs ON dogs.swab_code = t.swab_code
    WHERE trait_gene_id = 'MLPH_D'
  )
  SELECT
    dogs.*,
    pairs.swab_code_a,
    pairs.swab_code_b,
    pairs.relatedness,
    pairs.expected_offspring_coi,
    b_locus.value AS b_locus,
    d_locus.value AS d_locus,
    dogs.breeder
  FROM
    dogs
      INNER JOIN
    pairs ON pairs.swab_code_a = dogs.swab_code OR pairs.swab_code_b = dogs.swab_code
      LEFT JOIN
    b_locus ON b_locus.swab_code = dogs.swab_code
      LEFT JOIN
    d_locus ON d_locus.swab_code = dogs.swab_code
      WHERE
    dogs.swab_code != '${pet.swab}'
  ;`

  let rawData = await db.queryMany(sql, [calcVersion])

  if (options.onlyCOIs) {
    return _.map(rawData, r => ({ expected_offspring_coi: r.expected_offspring_coi, pet_id: r.pet_id, name: r.name, handle: r.handle }))
  }

  // as of april 2018 the input fields prevent periods in titles, but before that sometimes customers add periods `.` into the titles, but sometimes they don't, so for consistent presentation and filtering we go with period-less titles, and strip out all periods
  const removePeriods = string => _.filter(string, char => char !== '.').join('') || ''

  if (options.onlyTitles) {
    return _.chain(rawData)
      .map(r => [...removePeriods(_.get(r, 'profile.prefixTitles', '')).split(','), ...removePeriods(_.get(r, 'profile.suffixTitles')).split(',')])
      .flatten()
      .uniq()
      .filter()
      .sort()
      .value()
  }

  const breedCommonDiseasesInfo = Content.getBreedCommonDiseasesInfo(['doberman_pinscher'])
  const healthIds = _.map(breedCommonDiseasesInfo, 'healthId')
  const petIds = _.map(rawData, r => r.pet_id)

  const healthByPet = await Pets.getHealthCondensedForPets(petIds, healthIds)

  _.forEach(rawData, row => {
    const publicShare = Pets.getPrivacyBooleans(row.privacy, 'public')

    if (publicShare.health || row.user_id === userId) {
      // show public info, and info for other dogs owned by the current user
      row.health = healthByPet[row.pet_id]
      row.commonDiseaseResults = _.map(breedCommonDiseasesInfo, b => getHealthStateFromHealthCondensed(row.health, b.healthId))
      row.otherDiseaseResults = getOtherDiseaseResults(row.health)
    } else {
      row.commonDiseaseResults = _.map(breedCommonDiseasesInfo, b => '🔒')
      row.otherDiseaseResults = ['🔒']
    }
    if (publicShare.traits || row.user_id === userId) {
      // show public info, and info for other dogs owned by the current user
      row.offspringGenesBLocus = getOffspringGenesFor(petBLocus, row.b_locus, 'B', 'b')
      row.offspringGenesDLocus = getOffspringGenesFor(petDLocus, row.d_locus, 'D', 'd')
      row.offspringGenes = '<span style="white-space:nowrap;">' + row.offspringGenesBLocus + '</span><br/><span style="white-space:nowrap;">' + row.offspringGenesDLocus + '</span>'
    } else {
      row.offspringGenes = '🔒'
    }
    row.ageText = makeAgeTextFromDob(row.date_of_birth, row.date_of_birth_estimated)

    if (userLatLng.lat && row.breeder && row.breeder.addressParsed) {
      const addressParsed = _.isString(row.breeder.addressParsed) ? JSON.parse(row.breeder.addressParsed) : row.breeder.addressParsed
      row.lat = addressParsed.lat
      row.lng = addressParsed.lng
      row.addressAvailable = true
      row.distance = distance(row.lat, row.lng, userLatLng.lat, userLatLng.lng)
    } else {
      row.addressAvailable = false
    }
  })

  const healthStateToColor = {
    'Clear': 'green',
    'Carrier': 'orange',
    'At Risk': 'red'
  }

  const displayName = row => `${formatters.formatDogTitles(row.profile.prefixTitles)} <strong>${row.name}</strong> ${formatters.formatDogTitles(row.profile.suffixTitles)}`

  const htmlData = _.map(rawData, row => {
    const html = concat4([
      `<div style="padding-top: 16px; padding-bottom: 16px;"><a class="view-matchmaker-detail" href="/members/breeder-tools/matchmaker-details?myPetNum=${petNum}&theirHandle=${row.handle}">View</a></div>`,
      `${displayName(row)}` + (row.user_id === userId ? ' (My dog)' : '')
    ],
    showOwnerReportedBreed ? [ row.profile.breed ] : [],
    _.map(row.commonDiseaseResults, r => `<span class="text-${healthStateToColor[r] || 'dark-gray'}" style="font-weight: bold; white-space: nowrap;">${r}</span>`), [
      row.otherDiseaseResults,
      row.addressAvailable ? `<a target="_blank" href="https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}">${row.distance.toFixed(0)} miles</a>` : 'Unknown',
      row.profile.averageLitterSize || 'n/a',
      (row.profile.numberOfLitters === 0) ? '0' : (row.profile.numberOfLitters || 'n/a'),
      '<span style="white-space: nowrap;">' + row.ageText + '</span>',
      `<span class='${getCoiTrafficLightColor(Math.round(row.expected_offspring_coi), 'TODO ancestry_label_goes_here')}' style="font-weight: bold;">${row.expected_offspring_coi.toFixed(0)}</span>`,
      row.offspringGenes
    ])
    return html
  })
  return htmlData
}

function distance (lat1, lon1, lat2, lon2, unit) {
  // default unit is statute miles
  var radlat1 = Math.PI * lat1 / 180
  var radlat2 = Math.PI * lat2 / 180
  var theta = lon1 - lon2
  var radtheta = Math.PI * theta / 180
  var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
  dist = Math.acos(dist)
  dist = dist * 180 / Math.PI
  dist = dist * 60 * 1.1515
  if (unit === 'kilometers') {
    dist = dist * 1.609344
  } else if (unit === 'nautical_miles') {
    dist = dist * 0.8684
  }
  return dist
}
