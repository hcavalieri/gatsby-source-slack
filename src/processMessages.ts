import { shortnameToUnicode } from 'emojione';
import { boldString, italicizeString, strikeString } from './helpers';

export const processMessages = async ({ actions, graphql, getNode }: any) => {
  const { createNodeField } = actions;

  const graphqlData = await graphql(`
    {
      users: allSlackUser {
        edges {
          node {
            id
            userId
            real_name
            display_name
          }
        }
      }
      channels: allSlackChannel(filter: { is_private: { eq: false } }) {
        edges {
          node {
            channelId
            id
            messages {
              text
              user
              ts
              thread_ts
              reply_count
              files {
                title
                filetype
                thumb_360
                thumb_360_h
                thumb_360_w
              }
            }
          }
        }
      }
    }
  `);

  // Find the user from the database corresponding to the tag
  const replaceUser = (u: string) => {
    const userId = u.replace(/[@<>]/gi, '');
    const user = graphqlData.data.users.edges.find(({ node }: any) => {
      return node.userId === userId;
    });

    if (!user) {
      return '';
    }

    const { display_name, real_name } = user.node;
    return `<span class="chat-link">@${display_name || real_name}</span>`;
  };

  // Add an anchor element to referenced links in the text
  const replaceLink = (l: string) => {
    // Links, if posted without the http protocol, will have a | pipe
    // between the url itself and the text the user input
    // Ex: <https://github.com|github.com>
    const url = l.replace(/[<>]/gi, '');
    const linkWithProtocol = url.split('|')[0];
    const simplifiedLink = url.split('|')[1];

    return `<a href="${linkWithProtocol}" tabindex="-1" target="_blank" rel="noopener noreferrer">${simplifiedLink ||
      linkWithProtocol}</a>`;
  };

  // Add a class around the channel reference
  const replaceChannelReference = (c: string) =>
    `<span class="chat-link">${c}</span>`;

  // Add a class around the other channel mention
  const replaceOtherChannel = (l: string) => {
    // Mentions look like so: <#C024BE7LR|general>
    // so we remove < and >, and then split at the pipe,
    // much like the replaceLink function
    const url = l.replace(/[<>]/gi, '');
    const channelName = url.split('|')[1];

    return `<span class="chat-link">#${channelName}</span>`;
  };

  const processText = (t: string) => {
    // Emojis come in the form of :emoji:
    const emojiRegex = new RegExp(/:\w*:/gi);
    // Users come as <@US3RID>
    const userRegex = new RegExp(/<@[\w\d]*>/gi);
    // Links come as <http...>
    const linkRegex = new RegExp(/<http.*>/gi);
    // @channel references as <!channel>
    const channelReferenceRegex = new RegExp(/<!channel>/gi);
    // And the other channel mentions as <#C024BE7LR|general>
    const otherChannelRegex = new RegExp(/<#[\w\d]*\|[\w\d]*>/gi);

    const initialString = t
      .replace(emojiRegex, shortnameToUnicode)
      // If emoji hasn't been swapped with an unicode char,
      // that's because it's custom and should be removed
      .replace(emojiRegex, '')
      .replace(userRegex, replaceUser)
      .replace(linkRegex, replaceLink)
      .replace(channelReferenceRegex, replaceChannelReference)
      .replace(otherChannelRegex, replaceOtherChannel);

    return strikeString(italicizeString(boldString(initialString)))
      .split('\n')
      .map(p => `<p>${p}</p>`)
      .join('');
  };

  // We want to keep track of downloaded userImages to avoid them
  // running through the saveImage function again
  const fetchUser = (userId: string) => {
    const user = graphqlData.data.users.edges.find(({ node }: any) => {
      return node.userId === userId;
    });

    if (!user || !user.node) {
      return null;
    }

    return user.node.id;
  };

  for (const c of graphqlData.data.channels.edges) {
    const { node: channel } = c;

    let messages: any[] = [];
    if (channel.messages && channel.messages[0]) {
      for (const m of channel.messages) {
        const userInternalId = await fetchUser(m.user);
        const text = await processText(m.text);

        delete m.user;

        messages = [
          ...messages,
          {
            ...m,
            text,
            user___NODE: userInternalId,
          },
        ];
      }
    }

    // Fetch the complete node in order to add a new
    // 'normalizedMessages' field to it
    const originalNode = await getNode(channel.id);
    createNodeField({
      node: originalNode,
      name: 'normalizedMessages',
      value: messages,
    });
  }
};
