param(
    [ValidateSet("Simular", "Staging", "Importar", "DatosPrueba")]
    [string]$Modo = "Simular",

    [string]$Libro = (
        Join-Path $env:USERPROFILE `
            ".copilot\attachments\ebde4519-6c16-42cb-9586-3fd402b6dfef-Copia de  Agencia Lumamoto SM.xlsx"
    ),

    [string]$Organizacion = "LUMA_CENTRAL",

    [string]$SucursalPredeterminada = ""
)

$ErrorActionPreference = "Stop"
$directorioScripts = $PSScriptRoot
$directorioRaiz = Split-Path $directorioScripts -Parent
$importador = Join-Path $directorioScripts "importar_excel_luma.py"
$requisitos = Join-Path $directorioScripts "requisitos-importacion.txt"

if (-not (Test-Path -LiteralPath $Libro -PathType Leaf)) {
    throw "No se encontro el Excel: $Libro"
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python no esta instalado o no figura en PATH."
}

Set-Location $directorioRaiz

Write-Host "Preparando dependencias..." -ForegroundColor Cyan
& python -m pip install --quiet -r $requisitos
if ($LASTEXITCODE -ne 0) {
    throw "No se pudieron instalar las dependencias del importador."
}

$argumentos = @(
    $importador,
    "--libro", $Libro,
    "--organizacion", $Organizacion
)

if ($Modo -eq "Staging") {
    $argumentos += @("--aplicar", "--solo-staging")
}
elseif ($Modo -eq "Importar") {
    $argumentos += "--aplicar"
    if ($SucursalPredeterminada) {
        Write-Warning (
            "Todas las unidades importables se asignaran a la sucursal " +
            "'$SucursalPredeterminada'."
        )
        $argumentos += @(
            "--sucursal-predeterminada",
            $SucursalPredeterminada
        )
    }
}
elseif ($Modo -eq "DatosPrueba") {
    if ($Organizacion -ne "LUMA_CENTRAL") {
        throw (
            "DatosPrueba solo admite la organizacion LUMA_CENTRAL para evitar " +
            "asignar el libro real a otra empresa."
        )
    }

    $sucursalDatosPrueba = "San Miguel"
    Write-Warning (
        "Se importaran datos reales del libro exclusivamente como datos de prueba " +
        "en LUMA_CENTRAL / '$sucursalDatosPrueba'."
    )
    $argumentos += @(
        "--aplicar",
        "--datos-prueba",
        "--sucursal-predeterminada",
        $sucursalDatosPrueba
    )
}

if ($Modo -eq "Simular") {
    Write-Host "Ejecutando simulacion sin escribir en Neon..." -ForegroundColor Cyan
    & python @argumentos
    exit $LASTEXITCODE
}

$urlSegura = Read-Host `
    "Pegue la URL directa de Neon (la entrada permanecera oculta)" `
    -AsSecureString
$puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($urlSegura)

try {
    $urlBaseDatos = `
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero)
    $urlBaseDatos = $urlBaseDatos.Trim()

    if ($urlBaseDatos -match '^(?:\$env:)?DATABASE_URL_UNPOOLED\s*=\s*(.+)$') {
        $urlBaseDatos = $Matches[1].Trim()
    }

    $urlBaseDatos = $urlBaseDatos.Trim('"').Trim("'")
    $coincidenciaUrl = [regex]::Match(
        $urlBaseDatos,
        'postgres(?:ql)?://[^\s''"]+'
    )
    if ($coincidenciaUrl.Success) {
        $urlBaseDatos = $coincidenciaUrl.Value
    }

    if ($urlBaseDatos -notmatch '^postgres(?:ql)?://') {
        throw (
            "La entrada no es una URL directa de PostgreSQL. " +
            "Copie desde Neon solamente el valor que comienza con postgresql://"
        )
    }

    $env:DATABASE_URL_UNPOOLED = $urlBaseDatos

    Write-Host "Ejecutando modo $Modo para $Organizacion..." -ForegroundColor Cyan
    & python @argumentos
    if ($LASTEXITCODE -ne 0) {
        throw "El importador finalizo con codigo $LASTEXITCODE."
    }
}
finally {
    Remove-Item Env:DATABASE_URL_UNPOOLED -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero)
}
