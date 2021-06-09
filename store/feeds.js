import db from '@/plugins/db'
import Parser from 'rss-parser'
import getFeeds from 'get-feeds'
import { decrypt } from '~/plugins/crypt'
const CORS_PROXY =
  window.location.hostname === 'localhost'
    ? 'https://api.allorigins.win/raw?url='
    : 'https://api.allorigins.win/raw?url='

export const state = () => ({
  list: [],
  item: null,
  stories: [],
  suggested: [
    {
      contentSnippet: `A journey to find new and inspiring open-source libraries with a touch of India's food, people and culture.`,
      title: 'Open Pull Request',
      link: 'https://openpullrequest.substack.com/',
    },
    {
      contentSnippet: `Best known for the Hot 100 and Billboard 200, which list the most popular songs and albums each week in the industry. Offers industry news, events, podcasts, and music streaming.`,
      title: 'Billboard',
      link: 'https://www.billboard.com/',
    },
    {
      contentSnippet: `High-end business journalism keeping readers up-to-date on economic news as well as interviews with top entrepreneurs. There’s also educated predictions, trend analyses, and tips on how to improve businesses.`,
      title: 'Business Insider',
      link: 'https://www.businessinsider.com/',
    },
    {
      contentSnippet:
        'Podcasts, interviews, videos, and photo galleries covering the latest entertainment news in Australia and around the world. Articles primarily cover celebrity lifestyle, focusing on health, beauty, fashion, as well as travel.',
      title: 'TMZ',
      link: 'https://www.tmz.com/',
    },
    {
      contentSnippet:
        'Find business news, webinars and events, book recommendations, and interviews with successful entrepreneurs. The site is updated daily and even has a magazine for longer-form pieces.',
      title: 'Entrepreneur',
      link: 'https://www.entrepreneur.com/',
    },
    {
      contentSnippet:
        'The Verge is an ambitious multimedia effort founded nine years ago to examine how technology will change life in the future for a massive mainstream audience.',
      title: 'The Verge',
      link: 'https://www.theverge.com/',
    },
    {
      contentSnippet:
        'With an editorial focus on innovation in technology, world changing ideas, leadership, creativity, and design, FastCompany gives readers both economic news and advice on how to better grow their business.',
      title: 'Fast Company',
      link: 'https://www.fastcompany.com/',
    },
  ],
})

export const getters = {}

export const actions = {
  async addFeed({ dispatch }, { url }) {
    try {
      const parser = new Parser()
      const requestFeedUrl = url.replace(/\/$/, '')

      const { error, discoveredUrl } = await findFeedFromURL(requestFeedUrl)
      if (error) {
        console.error(error)
        return false
      }

      const feed = await parser.parseURL(CORS_PROXY + discoveredUrl)
      const { items } = parseFeeds([feed])

      const feedWithoutItems = Object.assign({}, feed, {
        items: [],
        feedUrl: discoveredUrl,
      })

      await db.feeds.put(feedWithoutItems)
      await db.items.bulkPut(items)

      await dispatch('saveFeedsAndItems')
      return { noOfItems: items.length, feedTitle: feed.title }
    } catch (error) {
      console.error(error)
      return false
    }
  },
  async addFromSuggested({ dispatch, state }, selectedSuggestionIndices) {
    const links = selectedSuggestionIndices.map(
      (suggestionIndex) => state.suggested[suggestionIndex].link
    )
    const addFeedResponse = await Promise.all(
      links.map((link) => dispatch('addFeed', { url: link }))
    )
    return addFeedResponse
  },
  async fetchFeedsOnly({ commit }) {
    await commit('setFeeds', { feeds: await db.feeds.toArray() })
  },
  async fetchAll({ dispatch, commit, state }) {
    await commit('settings/setLoading', true, { root: true })
    await dispatch('saveFeedsAndItems')

    try {
      await loadFeedItems(state)
      dispatch('saveFeedsAndItems')
    } catch (message) {
      console.error(message)
    } finally {
      await commit('settings/setLoading', false, { root: true })
    }
    return state.list
  },
  async saveFeedsAndItems({ dispatch }) {
    await dispatch('fetchFeedsOnly')
    await dispatch('items/fetchAll', {}, { root: true })
    dispatch('stories/fetchAll', null, { root: true })
  },
  async getFeed({ commit }, id) {
    commit('setFeed', await db.feeds.get({ link: decrypt(id) }))
  },
}

export const mutations = {
  setFeeds(state, { feeds }) {
    state.list = feeds
  },
  setFeed(state, feed) {
    state.item = feed
  },
  setSuggestedFeeds(state, suggestedFeeds) {
    state.suggested = suggestedFeeds
  },
}

async function loadFeedItems(state) {
  const parser = new Parser()
  const feedPromises = state.list.map(({ feedUrl }) => {
    return parser.parseURL(CORS_PROXY + feedUrl)
  })
  const resolvedFeeds = await Promise.all(feedPromises)
  const { items } = parseFeeds(resolvedFeeds)
  await db.items.bulkPut(items)
}

function isValidHttpUrl(string) {
  let url

  try {
    url = new URL(string)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_) {
    return false
  }
}

function parseFeeds(feeds) {
  const _items = []
  const _feeds = []
  feeds.forEach((feed) => {
    _feeds.push(Object.assign({}, feed, { items: [] }))
    _items.push(
      ...feed.items.map((item) =>
        Object.assign(item, {
          feedTitle: feed.title,
          feedLink: feed.link,
          guid: item.guid || item.id || item.link,
        })
      )
    )
  })
  return { feeds: _feeds, items: _items }
}

async function findFeedFromURL(url) {
  if (!isValidHttpUrl(url)) {
    return {
      error:
        'Invalid URL:' + url + '. Please enter a valid URL with http or https.',
    }
  }
  const feed = url.replace(/\/$/, '')

  const res = await checkAll(feed)
  if (res) return { error: null, discoveredUrl: res }

  return { error: 'No feed found for url: ' + url }
}

async function isRss(u) {
  const response = await fetch(CORS_PROXY + u).catch((e) => {
    return false
  })
  return response.ok && response.headers.get('content-type').includes('xml')
}

async function checkSuspects(f) {
  const usualSuspects = [
    '/feed.xml',
    '/rss.xml',
    '/feed',
    '/rss',
    '/atom.xml',
    '.rss',
  ]
  for (const suspect of usualSuspects) {
    if (await isRss(f + suspect)) return f + suspect
  }
  return ''
}

async function checkTheDom(url) {
  const response = await fetch(CORS_PROXY + url).catch((e) => {
    return false
  })

  if (response.ok) {
    const feeds = getFeeds(await response.text(), { url })
    if (feeds.length > 0) {
      return feeds[0].href
    }
  }
  return ''
}

async function checkAll(feed) {
  if (await isRss(feed)) {
    return feed
  }
  const urlInDOM = await checkTheDom(feed)
  if (urlInDOM) {
    return urlInDOM
  }
  return await checkSuspects(feed)
}
