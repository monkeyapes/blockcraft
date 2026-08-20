<#
    Publishes Blockcraft to GitHub: fills in your username everywhere, creates
    the repository, pushes, and kicks off the release build.

    Usage:   .\publish.ps1 -User yourname
             .\publish.ps1 -User yourname -Repo blockcraft -Private
#>
param(
    [Parameter(Mandatory = $true)][string]$User,
    [string]$Repo = 'blockcraft',
    [switch]$Private
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "Publishing as $User/$Repo" -ForegroundColor Cyan

# --- 1. Fill in the placeholder URLs --------------------------------------
$targets = @('README.md', 'site/index.html')
foreach ($f in $targets) {
    $text = Get-Content $f -Raw
    if ($text -match 'YOUR-USERNAME') {
        $text = $text -replace 'YOUR-USERNAME', $User
        # The repo name appears alongside the username in every link.
        $text = $text -replace "$User/blockcraft", "$User/$Repo"
        $text = $text -replace "$User\.github\.io/blockcraft", "$User.github.io/$Repo"
        Set-Content $f -Value $text -Encoding utf8 -NoNewline
        Write-Host "  filled in $f"
    }
}

# --- 2. Commit anything outstanding ---------------------------------------
git add -A
if (git status --porcelain) {
    git commit -q -m "Point published links at $User/$Repo"
    Write-Host "  committed link changes"
}

# --- 3. Create the remote --------------------------------------------------
# gh does this in one step if it is installed; otherwise you create the empty
# repo on github.com yourself and this just wires up the remote.
$hasGh = $null -ne (Get-Command gh -ErrorAction SilentlyContinue)

if ($hasGh) {
    $vis = if ($Private) { '--private' } else { '--public' }
    Write-Host "Creating the repository with gh..." -ForegroundColor Cyan
    gh repo create "$User/$Repo" $vis --source=. --remote=origin --push
} else {
    Write-Host @"

The GitHub CLI is not installed, so two steps are yours:

  1. Open https://github.com/new and create an EMPTY repository called
     '$Repo' -- no README, no .gitignore, no licence. If GitHub offers
     them, leave every checkbox clear, or the first push will be rejected.

  2. Come back here and press Enter.

"@ -ForegroundColor Yellow
    Read-Host "Press Enter once the empty repository exists"

    git remote remove origin 2>$null
    git remote add origin "https://github.com/$User/$Repo.git"
    Write-Host "Pushing (a sign-in window may appear)..." -ForegroundColor Cyan
    git push -u origin main
}

# --- 4. Tag the release, which builds and attaches the installer -----------
Write-Host "Tagging v0.1.0 to trigger the installer build..." -ForegroundColor Cyan
git tag -f v0.1.0
git push -f origin v0.1.0

Write-Host @"

Done. Two things finish on GitHub's side:

  Actions    https://github.com/$User/$Repo/actions
             'Release' builds the Windows installer (about 10 minutes) and
             attaches it to the release. 'Deploy site' publishes the site.

  Pages      https://github.com/$User/$Repo/settings/pages
             Set Source to 'GitHub Actions'. One click, once.

Then your links are live:

  Site       https://$User.github.io/$Repo/
  Play       https://$User.github.io/$Repo/play/
  Download   https://github.com/$User/$Repo/releases/latest

"@ -ForegroundColor Green
