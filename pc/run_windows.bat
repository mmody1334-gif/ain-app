@echo off
chcp 65001 >nul
title Hudhaifa - PC controller
echo Hudhaifa PC controller
echo First run installs the needed libraries (numpy, opencv-python, mediapipe).
echo.
py -3 -m pip install -q -r "%~dp0requirements.txt"
py -3 "%~dp0ain_pc_controller.py" --config "%~dp0control_config.json"
pause
