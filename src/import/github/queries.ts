/** GraphQL documents. Kept as plain strings so tests can assert on variables. */

const AUTHOR = `author {
  login
  avatarUrl
  ... on User { databaseId name }
  ... on Organization { databaseId name }
}`

/** Oldest first, so `--limit` is stable and an incremental run appends. */
export const DISCUSSIONS_QUERY = `query ImportDiscussions($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        number
        title
        body
        createdAt
        locked
        category { name description }
        ${AUTHOR}
      }
    }
  }
}`

export const COMMENTS_QUERY = `query ImportComments($id: ID!, $first: Int!, $after: String) {
  node(id: $id) {
    ... on Discussion {
      comments(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          body
          createdAt
          ${AUTHOR}
          replies(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes { id body createdAt ${AUTHOR} }
          }
        }
      }
    }
  }
}`

export const REPLIES_QUERY = `query ImportReplies($id: ID!, $first: Int!, $after: String) {
  node(id: $id) {
    ... on DiscussionComment {
      replies(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id body createdAt ${AUTHOR} }
      }
    }
  }
}`

export const discussionVars = (owner: string, name: string, first: number, after: string | null) => ({
  owner,
  name,
  first,
  after,
})

export const commentsVars = (id: string, first: number, after: string | null) => ({ id, first, after })
