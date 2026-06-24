" Autoinstall vim-plug
if empty(glob('~/.vim/autoload/plug.vim'))
  silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs
    \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

" Plugins
call plug#begin('~/.vim/plugged')

" Aesthetics
Plug 'lifepillar/vim-gruvbox8' " Gruvbox enhanced

" Search Helpers
Plug 'scrooloose/nerdtree' " Sidebar
Plug 'junegunn/fzf', { 'do': './install --bin' } " fuzzy finder
Plug 'junegunn/fzf.vim' " fuzzy finder vim extensions

" Coding Helpers
Plug 'w0rp/ale' " asynchronous lint engine
Plug 'tpope/vim-fugitive' " git wrapper

call plug#end()

" Set Tab Size for spaces
set tabstop=2 softtabstop=0 expandtab shiftwidth=2 smarttab

" Set specific indentations for different file types
autocmd Filetype html setlocal ts=2 sw=2 expandtab
autocmd Filetype sh setlocal ts=2 sw=2 expandtab

" keep lines below or above cursor while scrolling
set scrolloff=8

" highlight the line where your cursor is
set cursorline

" show a line where you should wrap text
set colorcolumn=81

" Turn on line numbers
set number

" Known Suffixes
set suffixesadd+=.js
set suffixesadd+=.jsx

" More natural opening for splits
set splitbelow
set splitright

" Syntax On
syntax on

" Show “invisible” characters
set lcs=tab:▸\ ,trail:·,eol:¬,nbsp:_
set lcs=tab:\ \ ,trail:·,nbsp:_
set list

" Highlight searches
set hlsearch

" Set theme gruvbox
colorscheme gruvbox8 " _soft || _hard contrast
set background=dark

" transparent background
hi Normal guibg=NONE ctermbg=NONE

" Unix line endings
set fileformat=unix
set ffs=unix

" enable copy for clipboard for osx
set clipboard=unnamed

" Tips from https://gist.github.com/csswizardry/9a33342dace4786a9fee35c73fa5deeb
" Currently unused


" Fix background colors with kitty
let &t_ut=''

" Plugin Helpers

" NerdTree

" Show hidden files by default
let NERDTreeShowHidden=1


" Local Overrides
let $LOCALFILE=expand("~/.vimrc_local")
if filereadable($LOCALFILE)
    source $LOCALFILE
endif

" mac
set backspace=indent,eol,start
