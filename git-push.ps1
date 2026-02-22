# GitHub 푸시 스크립트 (성원플라워)
# 사용법: PowerShell에서 .\git-push.ps1 실행
# 또는: 먼저 GitHub에서 새 저장소를 만든 뒤, 아래 YOUR_USERNAME, YOUR_REPO 수정 후 실행

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .git)) {
    Write-Host "Git 초기화 중..."
    git init
    git add .
    git commit -m "Initial commit: 성원플라워 대시보드"
    Write-Host "원격 저장소를 추가하려면 아래처럼 실행하세요:"
    Write-Host '  git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git'
    Write-Host '  git branch -M main'
    Write-Host '  git push -u origin main'
} else {
    git add .
    $status = git status --short
    if ($status) {
        git commit -m "Update: 성원플라워 대시보드"
        Write-Host "커밋 완료. 푸시는 다음으로 하세요: git push"
    } else {
        Write-Host "변경 사항 없음."
    }
}
