// Project Manager Elf - Oversees plans and tasks
import elf from '@silly/elf'

const db = {}

function node(name, children, isPlan = false) {
  const tree = {
    id: self.crypto.randomUUID(),
    name,
    children,
    done: false,
    expanded: false,
    isPlan: isPlan
  }

  db[tree.id] = tree

  return tree.id
}

const $ = elf('project-manager', {
  children: [
    node(
      'Plans',
      [],
      true
    )
  ],
  database: db
})

function update(id, data) {
  $.teach(data, (state, payload) => {
    return {
      ...state,
      database: {
        ...state.database,
        [id]: {
          ...state.database[id],
          ...payload
        }
      }
    }
  })
}

function toggleDone(id) {
  const { database } = $.learn()

  const node = database[id]

  update(id, { done: !node.done })
}

function toggleExpand(id) {
  const { database } = $.learn()

  const node = database[id]

  update(id, { expanded: !node.expanded })
}

$.draw(() => {
  const { children } = $.learn()
  return `
    <div class="project-manager">
      <h2>Project Overview</h2>
      ${children.map(renderNode).join('')}
    </div>
  `
}, afterUpdate)

function afterUpdate(target) {
  // Could be used for animations or other side effects
}

function renderNode(id) {
  const { database } = $.learn()
  const { name, children, done, expanded, isPlan } = database[id]
  
  if (isPlan) {
    // For plan nodes, show completion percentage instead of checkbox
    const total = children.reduce((sum, child) => sum + database[child].total, 0)
    const completed = children.reduce((sum, child) => sum + database[child].done, 0)
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    
    return `
      <div class="node plan-node" ${expanded ? 'data-expanded="true"':''}>
        <div class="node-header">
          <button class="expander" data-expand="${id}">
            ${expanded?'-':'+'}
          </button>
          <span class="plan-name">${name}</span>
          <span class="completion">${percent}% (${completed}/${total})</span>
        </div>
        ${expanded ? `
          <div class="children-container">
            ${children.map(renderNode).join('')}
          </div>
        `:''}
      </div>
    `
  } else {
    // For task nodes, show checkbox
    return children.length > 0 ? `
      <div class="node task-node" ${expanded ? 'data-expanded="true"':''}>
        <div class="node-header">
          <button class="expander" data-expand="${id}">
            ${expanded?'-':'+'}
          </button>
          <label>
            <input data-toggle="${id}" type="checkbox" ${done?'checked':''}/>
            ${name || ''}
          </label>
        </div>
        ${expanded ? `
          <div class="children-container">
            ${children.map(renderNode).join('')}
          </div>
        `:''}
      </div>
    `:`
      <div class="node task-node">
        <div class="node-header">
          <label>
            <input data-toggle="${id}" type="checkbox" ${done?'checked':''}/>
            ${name || 'Untitled'}
          </label>
        </div>
      </div>
    `
  }
}

$.when('click', '[data-toggle]', (event) => {
  const { toggle } = event.target.dataset
  toggleDone(toggle)
})

$.when('click', '[data-expand]', (event) => {
  const { expand } = event.target.dataset
  toggleExpand(expand)
})

$.style(`
  & {
    display: block;
    padding: 1rem;
    font-family: var(--monospace);
  }

  & .project-manager {
    background-color: var(--gray6);
    border-radius: var(--border-radius);
    padding: 1.5rem;
  }

  & h2 {
    color: var(--gray1);
    margin-top: 0;
    margin-bottom: 1rem;
  }

  & .node {
    display: block;
    margin-bottom: 0.5rem;
  }

  & .plan-node {
    border-left: 3px solid var(--primary);
    padding-left: 1rem;
  }

  & .node-header {
    display: flex;
    align-items: center;
  }

  & .expander {
    width: 2rem;
    height: 2rem;
    border-radius: 100%;
    display: inline-grid;
    place-content: center;
    border: none;
    background-color: var(--gray4);
    color: var(--gray1);
    font-weight: bold;
    cursor: pointer;
    margin-right: 0.5rem;
  }

  & .expander:hover {
    background-color: var(--gray3);
  }

  & .plan-name {
    flex-grow: 1;
    font-weight: bold;
    color: var(--gray1);
  }

  & .completion {
    background-color: var(--gray4);
    color: var(--gray1);
    padding: 0.2rem 0.5rem;
    border-radius: 0.3rem;
    font-size: 0.9rem;
  }

  & .task-node {
    padding-left: 1rem;
  }

  & .children-container {
    padding-left: 2rem;
  }

  & input[type="checkbox"] {
    margin-right: 0.5rem;
    width: 1.2rem;
    height: 1.2rem;
    cursor: pointer;
  }

  & label {
    cursor: pointer;
    user-select: none;
  }
`)

   // Function to load initial data from task-manifest.json
   async function loadInitialData() {
     try {
       console.log('Project manager: Loading task manifest...')
       const response = await fetch('/task-manifest.json')
       if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
       const taskTree = await response.json()
       
       // Clear existing data
       Object.keys(db).forEach(id => delete db[id])
       
       // Rebuild the tree from the manifest
       const rootId = node('Plans', [], true)
       buildTreeFromManifest(taskTree.children, rootId)
       
       // Force a redraw
       $.draw(() => {
         const { children } = $.learn()
         return `
           <div class="project-manager">
             <h2>Project Overview</h2>
             ${children.map(renderNode).join('')}
           </div>
         `
       }, afterUpdate)
       console.log('Project manager: Loaded task manifest successfully')
     } catch (error) {
       console.error('Failed to load task manifest:', error)
       // Optionally, show an error message in the UI
     }
   }

// Helper function to build tree from manifest
function buildTreeFromManifest(manifestItems, parentId) {
  manifestItems.forEach(item => {
    const isPlan = !item.items || item.items.length === 0 // Simplistic check
    const nodeId = node(item.name, [], isPlan)
    
    // Add to parent's children
    const parent = db[parentId]
    if (parent) {
      parent.children.push(nodeId)
    }
    
    // Process children recursively
    if (item.children && item.children.length > 0) {
      buildTreeFromManifest(item.children, nodeId)
    }
  })
}

// Load initial data when the elf is initialized
loadInitialData()