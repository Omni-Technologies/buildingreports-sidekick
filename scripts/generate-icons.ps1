<#
Generates the extension's local PNG icons (16/32/48/128) with .NET
System.Drawing - no external tools or npm dependencies required.

Design: a simple, brand-neutral rounded slate-blue square with a white
checkmark, representing "cleanup/verification". Does not use or reference
any BuildingReports logo, wordmark, or color scheme.

Run manually whenever the icon design needs to change:
  powershell -File scripts/generate-icons.ps1
#>

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\src\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$sizes = 16, 32, 48, 128

# Brand-neutral palette: deep slate-blue background, white glyph.
$bgColor = [System.Drawing.Color]::FromArgb(255, 30, 58, 95)      # #1E3A5F
$fgColor = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)   # white

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded-rect background
    $radius = [Math]::Max(2, [int]($size * 0.18))
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush($bgColor)
    $g.FillPath($brush, $path)

    # Checkmark glyph, proportional to icon size
    $penWidth = [Math]::Max(1.5, $size * 0.11)
    $pen = New-Object System.Drawing.Pen($fgColor, $penWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $p1 = New-Object System.Drawing.PointF([float]($size * 0.27), [float]($size * 0.52))
    $p2 = New-Object System.Drawing.PointF([float]($size * 0.44), [float]($size * 0.70))
    $p3 = New-Object System.Drawing.PointF([float]($size * 0.76), [float]($size * 0.32))
    $g.DrawLines($pen, @($p1, $p2, $p3))

    $destPath = Join-Path $outDir ("icon{0}.png" -f $size)
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $pen.Dispose()
    $brush.Dispose()
    $path.Dispose()
    $g.Dispose()
    $bmp.Dispose()

    Write-Host "Wrote $destPath"
}
