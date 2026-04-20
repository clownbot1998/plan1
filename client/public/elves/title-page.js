import module from '@silly/tag'
const $ = module('title-page')

$.draw((target) => {
  const title = target.getAttribute('title')
  const author = target.getAttribute('author')
  const contact = target.getAttribute('contact')
  const agent = target.getAttribute('agent')

  return `
    <div name="cover">
      <div name="main">
        <div name="title">
          ${title}
        </div>
        by
        <div name="author">
          ${author}
        </div>
      </div>
      <div name="contact">
        ${markup(contact) || '' }
      </div>
      <div name="agent">
        ${markup(agent) || '' }
      </div>
    </div>
  `
})

function markup(string) {
  return string && string.replaceAll('\\', '<br>')
}

$.style(`
  & {
    display: block;
    position: relative;
    height: 9in;
    break-after: page;
    page-break-after: always;
  }

  & [name="cover"] {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  & [name="main"] {
    text-align: center;
  }

  & [name="title"] {
    display: block;
    margin-bottom: 1rem;
  }

  & [name="author"] {
    display: block;
  }

  & [name="contact"] {
    position: absolute;
    bottom: 0;
    left: 0;
  }

  & [name="agent"] {
    position: absolute;
    bottom: 0;
    right: 0;
  }
`)
