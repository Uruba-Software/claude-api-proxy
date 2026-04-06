#!/usr/bin/env bash
# restore-dev-env.sh — Geliştirme ortamına geri dön
# Kullanım: bash scripts/restore-dev-env.sh
set -e

REPO_DIR="$HOME/projects/claude-api-proxy"
GITHUB_ORG="Uruba-Software"
GITHUB_REPO="claude-api-proxy"

echo ""
echo "=== claude-api-proxy geliştirme ortamı kurulumu ==="
echo ""

# ── 1. Klasöre geç ─────────────────────────────────────────────────────────
if [ ! -d "$REPO_DIR" ]; then
  echo "❌  $REPO_DIR bulunamadı."
  echo "    Repo klonlanıyor..."
  GITHUB_TOKEN=$(notes-secret get github-uruba-token 2>/dev/null || echo "")
  if [ -n "$GITHUB_TOKEN" ]; then
    git clone "https://${GITHUB_TOKEN}@github.com/${GITHUB_ORG}/${GITHUB_REPO}.git" "$REPO_DIR"
  else
    git clone "https://github.com/${GITHUB_ORG}/${GITHUB_REPO}.git" "$REPO_DIR"
  fi
fi

cd "$REPO_DIR"
echo "✓  Klasör: $REPO_DIR"

# ── 2. Son değişiklikleri çek ───────────────────────────────────────────────
git pull origin main 2>/dev/null && echo "✓  git pull tamamlandı" || echo "⚠  git pull atlandı (yerel değişiklik var)"

# ── 3. GitHub CLI login (biyro02) ───────────────────────────────────────────
CURRENT_GH_USER=$(gh api user --jq '.login' 2>/dev/null || echo "")
if [ "$CURRENT_GH_USER" != "biyro02" ]; then
  echo ""
  echo "→  GitHub CLI biyro02 hesabına geçiliyor..."
  GITHUB_TOKEN=$(notes-secret get github-uruba-token 2>/dev/null || echo "")
  if [ -n "$GITHUB_TOKEN" ]; then
    echo "$GITHUB_TOKEN" | gh auth login --with-token
    gh auth switch --user biyro02
    echo "✓  GitHub: biyro02"
  else
    echo "⚠  github-uruba-token bulunamadı. Manuel: gh auth login"
  fi
else
  echo "✓  GitHub: biyro02 (zaten aktif)"
fi

# ── 4. npm login (buluad) ───────────────────────────────────────────────────
NPM_USER=$(npm whoami 2>/dev/null || echo "")
if [ "$NPM_USER" != "buluad" ]; then
  echo ""
  echo "→  npm'e buluad olarak giriş gerekiyor."
  echo "   Terminalde şunu çalıştır: npm login"
  echo "   Kullanıcı adı: buluad"
  echo ""
else
  echo "✓  npm: buluad (zaten giriş yapılmış)"
fi

# ── 5. Testleri çalıştır ────────────────────────────────────────────────────
echo ""
echo "→  Testler çalışıyor..."
npm test
echo ""

# ── 6. Durum özeti ─────────────────────────────────────────────────────────
echo "=== Hazır ==="
echo ""
echo "  Klasör   : $REPO_DIR"
echo "  GitHub   : https://github.com/${GITHUB_ORG}/${GITHUB_REPO}"
echo "  npm      : https://www.npmjs.com/package/${GITHUB_REPO}"
echo "  Versiyon : $(node -p "require('./package.json').version")"
echo ""
echo "Komutlar:"
echo "  npm test                  → testleri çalıştır"
echo "  node bin/claude-api-proxy.js --help"
echo "  node bin/claude-api-proxy.js setup"
echo "  node bin/claude-api-proxy.js --no-launch"
echo ""
