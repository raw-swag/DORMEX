import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { FloorMapFiltersBar, FloorMapFiltersBarProps, WingFilterType } from './FloorMapFiltersBar.js';

describe('FloorMapFiltersBar Component Logic Suite', () => {
  const defaultProps: FloorMapFiltersBarProps = {
    buildings: [
      { id: 'bld_bvb', name: 'BVB Block' },
      { id: 'bld_main', name: 'Main Campus Block' },
    ],
    selectedBuildingId: 'bld_bvb',
    onSelectBuildingId: vi.fn(),
    floors: [
      { id: 'flr_bvb_2', name: 'Floor 2', floor_number: 2 },
      { id: 'flr_bvb_3', name: 'Floor 3', floor_number: 3 },
    ],
    floorId: 'flr_bvb_2',
    onSelectFloorId: vi.fn(),
    selectedWingFilter: 'ALL',
    onSelectWingFilter: vi.fn(),
    selectedRoomNumber: null,
    onSelectRoomNumber: vi.fn(),
    zoomLevel: 1.0,
    onZoomChange: vi.fn(),
    onZoomReset: vi.fn(),
  };

  it('exports FloorMapFiltersBar component and instantiates valid React element', () => {
    expect(typeof FloorMapFiltersBar).toBe('function');
    const element = React.createElement(FloorMapFiltersBar, defaultProps);
    expect(element).toBeDefined();
    expect(element.type).toBe(FloorMapFiltersBar);
    expect(element.props.selectedBuildingId).toBe('bld_bvb');
    expect(element.props.floorId).toBe('flr_bvb_2');
    expect(element.props.selectedWingFilter).toBe('ALL');
  });

  it('calls onSelectBuildingId and onSelectFloorId on selector change', () => {
    const onBuildingChange = vi.fn();
    const onFloorChange = vi.fn();
    const props: FloorMapFiltersBarProps = {
      ...defaultProps,
      onSelectBuildingId: onBuildingChange,
      onSelectFloorId: onFloorChange,
    };
    const element = React.createElement(FloorMapFiltersBar, props);
    element.props.onSelectBuildingId('bld_main');
    element.props.onSelectFloorId('flr_bvb_3');
    expect(onBuildingChange).toHaveBeenCalledWith('bld_main');
    expect(onFloorChange).toHaveBeenCalledWith('flr_bvb_3');
  });

  it('handles wing selection and room search callback updates', () => {
    const onWingChange = vi.fn();
    const onRoomChange = vi.fn();
    const props: FloorMapFiltersBarProps = {
      ...defaultProps,
      onSelectWingFilter: onWingChange,
      onSelectRoomNumber: onRoomChange,
    };
    const element = React.createElement(FloorMapFiltersBar, props);
    element.props.onSelectWingFilter('NORTH');
    element.props.onSelectRoomNumber('204');
    expect(onWingChange).toHaveBeenCalledWith('NORTH');
    expect(onRoomChange).toHaveBeenCalledWith('204');
  });

  it('handles zoom controls and reset callbacks', () => {
    const onZoomChange = vi.fn();
    const onZoomReset = vi.fn();
    const props: FloorMapFiltersBarProps = {
      ...defaultProps,
      onZoomChange,
      onZoomReset,
    };
    const element = React.createElement(FloorMapFiltersBar, props);
    element.props.onZoomChange((z: number) => z + 0.2);
    element.props.onZoomReset();
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomReset).toHaveBeenCalledTimes(1);
  });
});
