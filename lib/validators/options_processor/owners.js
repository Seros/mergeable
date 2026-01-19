const gitPattern = require('./gitPattern')
const Teams = require('./teams')
const _ = require('lodash')
const GithubAPI = require('../../github/api')

class Owner {
  static async process (payload, context, approvedReviewers) {
    const CODEOWNERS = await retrieveCODEOWNER(context, payload.number)

    if (CODEOWNERS === null) return []

    const owners = gitPattern.parseOwnerFile(CODEOWNERS)

    const compare = await GithubAPI.compareCommits(context, context.repo({
      base: payload.base.sha,
      head: payload.head.sha
    }))

    const paths = compare.files.map(file => file.filename)

    // Track which paths need approval
    const pathsNeedingApproval = []
    let allOwners = []

    for (const path of paths) {
      const pathOwners = owners.for(path)
      if (pathOwners.length > 0) {
        // Extract user IDs from owners
        const ownerIds = await extractUserId(pathOwners)
        const { teams, individuals } = this.separateTeamsAndIndividuals(ownerIds)

        let pathOwnerList = [...individuals]

        // Get team members if there are teams
        if (teams.length > 0) {
          let teamMembers = []
          teamMembers = await Teams.extractTeamMemberships(context, teams, approvedReviewers)
          pathOwnerList = _.union(teamMembers, pathOwnerList)
        }

        // Check if any owner of this path has approved
        const hasApproval = approvedReviewers && approvedReviewers.length > 0
          ? _.intersection(pathOwnerList, approvedReviewers).length > 0
          : false

        if (!hasApproval) {
          pathsNeedingApproval.push({
            path,
            owners: pathOwnerList
          })
        }

        // Collect all unique owners across all paths
        allOwners = _.union(allOwners, pathOwnerList)
      }
    }

    // If we're checking approvals, return only owners from paths that need approval
    if (approvedReviewers && approvedReviewers.length > 0) {
      const unapprovedOwners = pathsNeedingApproval.flatMap(p => p.owners)
      return _.uniq(unapprovedOwners)
    }

    // Otherwise return all owners (for initial required list)
    return allOwners
  }

  static separateTeamsAndIndividuals (owners) {
    const teams = []
    const individuals = []
    owners.forEach(owner => {
      if (owner.includes('/')) teams.push(owner)
      else individuals.push(owner)
    })

    return { teams, individuals }
  }
}

const extractUserId = async (owners) => {
  return owners.map(owner => {
    if (owner.charAt(0) === '@') {
      return owner.slice(1)
    } else if (EMAIL_REGEX.test(owner)) {
      return owner
    } else {
      return owner
    }
  })
}

const retrieveCODEOWNER = async (context, pullNumber) => {
  // if PR contains a modified/added CODEOWNER, use that instead
  const repo = context.repo()

  if (['pull_request', 'pull_request_review'].includes(context.eventName)) {
    // get modified file list
    const result = await GithubAPI.listFiles(context, context.repo({ pull_number: context.payload.pull_request.number }))

    const modifiedFiles = result
      .filter(file => ['modified', 'added'].includes(file.status))
      .map(file => file.filename)

    // check if config file is in that list

    if (modifiedFiles.includes(OWNER_FILE_PATH)) {
      // if yes return, return below else do nothing
      const callParam = {
        owner: repo.owner,
        repo: repo.repo,
        path: OWNER_FILE_PATH,
        ref: context.payload.pull_request.head.sha
      }
      return GithubAPI.getContent(context, callParam)
    }
  }

  return GithubAPI.getContent(context, context.repo({
    path: OWNER_FILE_PATH
  }))
}

const OWNER_FILE_PATH = '.github/CODEOWNERS'
const EMAIL_REGEX = '(?:[a-z0-9!#$%&\'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&\'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\\])'

module.exports = Owner
