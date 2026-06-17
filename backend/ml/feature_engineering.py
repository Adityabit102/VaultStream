import pandas as pd
import numpy as np
from datetime import datetime

def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes rolling-window counts, rolling averages, unique merchant category counts,
    device shifts, amount z-scores, and time-based metrics from raw transaction data.
    Ensures safe alignment back to the input DataFrame even in the presence of duplicate timestamps.
    """
    # 1. Sort chronologically by TransactionDT and reset index to preserve row alignment
    df = df.sort_values('TransactionDT').reset_index(drop=True)

    # 2. Convert TransactionDT to datetimes
    reference_date = datetime(2017, 11, 30)
    df['datetime'] = reference_date + pd.to_timedelta(df['TransactionDT'], unit='s')

    # 3. Rolling window calculations grouped by card1 (representing card/entity ID)
    
    # We use minimal dataframes containing only necessary columns to avoid string conversion errors
    df_count = df[['card1', 'datetime', 'TransactionID']].copy()
    grouped_count = df_count.groupby('card1')

    # tx_count_5m: 5-minute rolling window count
    roll_5m = grouped_count.rolling('300s', on='datetime', closed='right').count()['TransactionID']
    df['tx_count_5m'] = roll_5m.reset_index(level=0, drop=True)

    # tx_count_1h: 60-minute rolling window count
    roll_1h = grouped_count.rolling('3600s', on='datetime', closed='right').count()['TransactionID']
    df['tx_count_1h'] = roll_1h.reset_index(level=0, drop=True)

    # tx_count_24h: 24-hour rolling window count
    roll_24h = grouped_count.rolling('86400s', on='datetime', closed='right').count()['TransactionID']
    df['tx_count_24h'] = roll_24h.reset_index(level=0, drop=True)

    # avg_amount_1h: 60-minute rolling window mean transaction amount
    df_amt = df[['card1', 'datetime', 'TransactionAmt']].copy()
    roll_avg = df_amt.groupby('card1').rolling('3600s', on='datetime', closed='right').mean()['TransactionAmt']
    df['avg_amount_1h'] = roll_avg.reset_index(level=0, drop=True)

    # unique_merchant_count_1h: 60-minute distinct ProductCD category count
    df['unique_merchant_count_1h'] = 0
    df['ProductCD'] = df['ProductCD'].fillna('unknown').astype(str)
    for p in ['W', 'H', 'C', 'S', 'R']:
        dummy = pd.DataFrame({
            'card1': df['card1'],
            'datetime': df['datetime'],
            'is_p': (df['ProductCD'] == p).astype(int)
        })
        roll_sum = dummy.groupby('card1').rolling('3600s', on='datetime', closed='right').sum()['is_p']
        df['unique_merchant_count_1h'] += (roll_sum.reset_index(level=0, drop=True) > 0).astype(int)

    # 4. Device Shift Flag: 1 if DeviceType or DeviceInfo changed within 30 minutes, else 0
    df['DeviceType'] = df['DeviceType'].fillna('unknown').astype(str)
    df['DeviceInfo'] = df['DeviceInfo'].fillna('unknown').astype(str)

    grouped_full = df.groupby('card1')
    prev_device_type = grouped_full['DeviceType'].shift(1)
    prev_device_info = grouped_full['DeviceInfo'].shift(1)
    prev_time = grouped_full['TransactionDT'].shift(1)

    time_diff = df['TransactionDT'] - prev_time
    device_changed = (df['DeviceType'] != prev_device_type) | (df['DeviceInfo'] != prev_device_info)
    df['device_shift_flag'] = ((time_diff <= 1800) & device_changed).astype(int)

    # 5. Amount Z-Score: TransactionAmt relative to expanding historical mean and std per card1
    # Note: expanding() includes the current transaction, matching the live consumer state update
    exp_mean = grouped_full['TransactionAmt'].expanding().mean().reset_index(level=0, drop=True)
    exp_std = grouped_full['TransactionAmt'].expanding().std().reset_index(level=0, drop=True)

    df['amount_zscore'] = (df['TransactionAmt'] - exp_mean) / exp_std
    df['amount_zscore'] = df['amount_zscore'].fillna(0.0) # Handle NaN std (first transaction)

    # 6. Hour of day and weekend indicators
    df['hour_of_day'] = df['datetime'].dt.hour
    df['is_weekend'] = df['datetime'].dt.weekday.isin([5, 6]).astype(int)

    # Cleanup intermediate columns
    df = df.drop(columns=['datetime'])

    return df
