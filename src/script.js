// copyed form https://github.com/ptrpaws lol
import fs from 'fs';
import fetch from 'node-fetch';
import Handlebars from 'handlebars';

async function queryUserStats(username, token) {
  const now = new Date();
  const beginningOfYear = new Date(now.getFullYear(), 0, 1);
  const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

  const query = `
    query($username: String!, $from: DateTime, $to: DateTime) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          restrictedContributionsCount
        }
        pullRequests { totalCount }
        issues { totalCount }
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
          nodes { 
            stargazerCount
            name
            description
            url
            isArchived
          }
        }
        repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
          totalCount
        }
      }
    }
  `;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'JavaScript GitHub README Generator',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        username,
        from: beginningOfYear.toISOString(),
        to: endOfYear.toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned non-success status: ${response.status}`);
  }

  const gqlResponse = await response.json();
  if (gqlResponse.errors) {
    throw new Error('GraphQL query failed.');
  }

  if (!gqlResponse.data) {
    throw new Error("Missing 'data' field in GraphQL response");
  }

  return gqlResponse.data.user;
}

async function fetchLanguagesForRepos(repos, token) {
  const langMaps = await Promise.all(
    repos
      .filter((repo) => {
        if (repo.fork) {
          return false;
        }
        const topics = repo.topics || [];
        if (topics.includes('mirror') || topics.includes('no-stats')) {
          return false;
        }
        return true;
      })
      .map(async (repo) => {
        try {
          const response = await fetch(repo.languages_url, {
            headers: {
              'Authorization': `token ${token}`,
              'User-Agent': 'JavaScript GitHub README Generator',
            },
          });
          return await response.json();
        } catch {
          return {};
        }
      })
  );

  const languages = {};
  for (const map of langMaps) {
    for (const [lang, bytes] of Object.entries(map)) {
      languages[lang] = (languages[lang] || 0) + bytes;
    }
  }

  const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0);
  if (totalBytes === 0) {
    return [];
  }

  const languagePercentages = Object.entries(languages)
    .map(([lang, count]) => [lang, (count / totalBytes) * 100])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return languagePercentages;
}

async function calculateLanguageStats(username, token) {
  let allRepos = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/user/repos?type=all&per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'JavaScript GitHub README Generator',
      },
    });

    const repos = await response.json();
    if (repos.length === 0) {
      break;
    }
    allRepos = allRepos.concat(repos);
    page++;
  }

  const publicRepos = allRepos.filter((repo) => !repo.private);
  const privateRepos = allRepos.filter((repo) => repo.private);

  const publicLanguages = await fetchLanguagesForRepos(publicRepos, token);
  const privateLanguages = await fetchLanguagesForRepos(privateRepos, token);

  return {
    public: publicLanguages,
    private: privateLanguages,
  };
}

function abbreviateNumber(n) {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return n.toString();
}

function renderProgressBar(percentage) {
  const numFilled = Math.max(0, Math.round(percentage / 10.0));
  const numEmpty = Math.max(0, 10 - numFilled);
  return '▓'.repeat(numFilled) + '░'.repeat(numEmpty);
}

function formatLangName(lang) {
  const nameMap = {
    'Visual Basic .NET': 'VB.NET',
    'Jupyter Notebook': 'Jupyter',
  };
  return nameMap[lang] || lang;
}

function formatTopRepos(repos) {
  return repos
    .filter(repo => !repo.isArchived)
    .sort((a, b) => b.stargazerCount - a.stargazerCount)
    .slice(0, 5)
    .map(repo => ({
      name: repo.name,
      stars: repo.stargazerCount,
      description: repo.description || 'No description',
      url: repo.url,
    }));
}

const config = {
  showPrivateLanguages: false,
  showApiCards: false,
};

async function main() {
  try {
    const username = 'official-notfishvr';
    const token = process.env.GH_PAT;

    if (!token) {
      throw new Error('GH_PAT environment variable not set');
    }

    const userStats = await queryUserStats(username, token);
    const languageStats = await calculateLanguageStats(username, token);

    const totalStars = userStats.repositories.nodes.reduce(
      (sum, repo) => sum + repo.stargazerCount,
      0
    );
    const totalCommitsThisYear =
      userStats.contributionsCollection.totalCommitContributions +
      userStats.contributionsCollection.restrictedContributionsCount;

    const displayPublicLangs = languageStats.public.map(([lang, percentage]) => ({
      name: formatLangName(lang).padEnd(15),
      bar: renderProgressBar(percentage),
      percentage_str: `${percentage.toFixed(2)}%`,
    }));

    const displayPrivateLangs = config.showPrivateLanguages ? languageStats.private.map(([lang, percentage]) => ({
      name: formatLangName(lang).padEnd(15),
      bar: renderProgressBar(percentage),
      percentage_str: `${percentage.toFixed(2)}%`,
    })) : [];

    const topRepos = formatTopRepos(userStats.repositories.nodes);

    const templateData = {
      username,
      total_stars: abbreviateNumber(totalStars),
      total_commits_this_year: abbreviateNumber(totalCommitsThisYear),
      total_prs: abbreviateNumber(userStats.pullRequests.totalCount),
      total_issues: abbreviateNumber(userStats.issues.totalCount),
      contributed_to: abbreviateNumber(userStats.repositoriesContributedTo.totalCount),
      public_languages: displayPublicLangs,
      private_languages: displayPrivateLangs,
      top_repos: topRepos,
      show_private_languages: config.showPrivateLanguages,
      show_api_cards: config.showApiCards,
      last_updated: `Last updated ${new Date().toISOString().split('T')[0]} UTC`,
    };

    const templateContent = fs.readFileSync('templates/README.md.hbs', 'utf-8');
    const template = Handlebars.compile(templateContent);
    const readmeContent = template(templateData);

    fs.writeFileSync('../README.md', readmeContent);
    console.log('README.md generated successfully!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
