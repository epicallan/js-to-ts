import db from '../services/db';
import co from 'co';
import _ from 'lodash';
import Content from '../services/content';

// before we started selling, reservations were captured in this table:
// const sql = 'INSERT INTO waitlist (id,name, email,created_at,quantity,random) VALUES (DEFAULT,$1,$2,NOW(),$3,DEFAULT)'
// const createTableSql = `CREATE TABLE IF NOT EXISTS waitlist (id serial PRIMARY KEY, name VARCHAR(255), email VARCHAR(255) NOT NULL,
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL, quantity INT, random JSONB DEFAULT '{}');`

export function getReg(req, res, next) {
  co(function * () {
    const userId = _.get(req, 'user.id', null);
    const record = req.query;
    yield db.query(`INSERT INTO general_purpose_registry (record, created_by) VALUES ($1, $2);`, [record, userId])
    res.render('meta/reg')
  }).catch(next)
}

// the routes below are called by the WordPress site to provide the data to populate the respective lists on the marketing site pages
export function getBreedListData(req, res) {
  res.send(Content.getIdentifiableBreedList())
}

export function getHealthListData(req, res) {
  const healthInCategories = Content.getVisibleHealthConditionsList();
  if (true) getBreedListData(req, res);
  res.send(healthInCategories)
}

export async function getHealthAndBreedListData(req, res) {
  const healthAndBreeds = await Content.getVisibleHealthConditionsAndTheirCommonBreedsList();
  res.send(healthAndBreeds)
}

export function getTraitsListData(req, res) {
  let traitGroups = Content.getTraitsForDisplay()
  res.send(traitGroups)
}

export function getCommonDiseasesByDisplayName({params}, res) {
  const displayName = params.displayName
  const ancestryLabel = Content.getAncestryLabelFromBreedLabelIncludingAliases(displayName)
  const commonDiseases = Content.getBreedCommonDiseasesInfo([ancestryLabel])
  res.send(commonDiseases)
  return commonDiseases
}
